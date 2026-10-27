"""Builds a client export from this server's database, without the browser.

The client's Export step (manifest-export.ts) is the usual way to get an
`open-insights-export-*` dataset, but it needs every record imported, matched to
its video and scanned in a browser first. Everything that export carries is
already here: the Scan results are in the database, the YouTube figures are in
the Studio "Content" reports, and the one thing neither holds - which video file
is which YouTube video - is a CSV. So this writes the same tree, unzipped and
without video files, for the records that CSV lists:

    python scripts/build_export.py OUT --videos-csv VIDEOS.csv --youtube REPORT.csv [...]
        [--zip FILE.zip] [--db DB_PATH] [--uploads UPLOAD_FOLDER]

VIDEOS.csv has a row per record, in export order, with at least `hash` (the
upload's SHA-256), `video_id` (the YouTube id, the reports' `Content` column) and
`title`. An optional `retention` column names that video's Studio audience
retention export (All.csv), relative to VIDEOS.csv. The 144 lecture videos' copy
is data/sample/edu-video-insights/videos.csv; their export is
data/sample/edu-video-insights-export/, and --zip the same tree zipped, as the
browser's Export step downloads it.

Each field is derived as the client derives it, so data_preparation.py and
compare_upstream.py read the result as they would a browser export:

    youtube_content       parseYoutubeContentCsv (youtube-csv-import.ts)
    transcript_stats      the transcript's counts, plus speech_pace_variation
                          (speech-features.ts) against recordDurationTiers'
                          duration (video-duration.ts)
    scene/text/audio      the database rows, as the server's API returns them
    video_file            duration from the container, as the browser reads it
    audience_retention/   parseYoutubeAudienceRetentionCsv (youtube-csv-import.ts)
    transcript/<hash>.srt transcriptToSrt (manifest-export.ts)

scan_provenance carries each result's producer and time but no settings: those
are the browser's, and this never saw them. Every record must have every Scan
result; a missing one stops the build and names the video.
"""

import argparse
import csv
import json
import math
import re
import sqlite3
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import av

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DB_PATH, UPLOAD_FOLDER  # noqa: E402

# The window speech pace variation measures WPM over (SPEECH_PACE_WINDOW_SECS).
SPEECH_PACE_WINDOW_SECS = 30

# The columns of each results table the client's SceneStats/TextStats/AudioStats
# carry - the rest (samples_json, producer, produced_at) stay on the server.
STATS_COLUMNS = {
    "scene_stats": ("duration_secs", "scenes"),
    "text_stats": ("sample_count", "mean_words", "max_words", "mean_coverage", "text_frames_ratio"),
    "audio_stats": (
        "duration_secs",
        "speech_secs",
        "speech_level_db",
        "background_sound_ratio",
        "median_pitch_hz",
        "pitch_variation_st",
        "speech_ratio",
        "pause_rate_per_min",
        "mean_pause_secs",
    ),
}


def js_round(value: float) -> int:
    """Math.round: halves go up, where Python's round() goes to even."""
    return math.floor(value + 0.5)


def js_number(value):
    """A number as JSON.stringify would write it: an integral float has no '.0'."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def parse_nullable_number(value: str | None) -> float | int | None:
    if value is None or value.strip() == "":
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return None if math.isnan(number) else js_number(number)


def parse_duration_to_seconds(value: str | None) -> int | float | None:
    """'MM:SS' or 'H:MM:SS', as Studio writes Average view duration."""
    if not value:
        return None
    try:
        parts = [float(part) for part in value.split(":")]
    except ValueError:
        return None
    total = 0.0
    for part in parts:
        total = total * 60 + part
    return js_number(total)


def parse_youtube_content_csv(path: Path) -> dict[str, dict]:
    """parseYoutubeContentCsv, keyed by the Content column (the YouTube id)."""
    out = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if not any(row.values()):
                continue
            duration = row.get("Duration")
            content = {
                "content": row.get("Content") or None,
                "engaged_views": None,
                "average_percentage_viewed": None,
                "stayed_to_watch": None,
                "unique_viewers": None,
                "unique_reach": None,
                "average_views_per_viewer": None,
                "new_viewers": None,
                "regular_viewers": None,
                "casual_viewers": None,
                "returning_viewers": None,
                "views": parse_nullable_number(row.get("Views")),
                "watch_time_hours": parse_nullable_number(row.get("Watch time (hours)")),
                "subscribers": parse_nullable_number(row.get("Subscribers")),
                "average_view_duration_secs": parse_duration_to_seconds(
                    row.get("Average view duration")
                ),
                "duration_secs": parse_duration_to_seconds(duration)
                if duration and ":" in duration
                else parse_nullable_number(duration),
                "impressions": parse_nullable_number(row.get("Impressions")),
                "impressions_click_through_rate": parse_nullable_number(
                    row.get("Impressions click-through rate (%)")
                ),
            }
            if content["content"]:
                out[content["content"]] = content
    return out


def parse_youtube_audience_retention_csv(path: Path) -> dict:
    """parseYoutubeAudienceRetentionCsv: the rows with both columns numeric."""
    video_position, absolute_audience_retention = [], []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            position = parse_nullable_number(row.get("Video position (%)"))
            retention = parse_nullable_number(row.get("Absolute audience retention (%)"))
            if position is not None and retention is not None:
                video_position.append(position)
                absolute_audience_retention.append(retention)
    return {
        "video_position": video_position,
        "absolute_audience_retention": absolute_audience_retention,
    }


def word_count(text: str) -> int:
    return len([word for word in re.split(r"\s+", text.strip()) if word]) if text else 0


def speech_pace_variation(
    segments: list[dict], duration_secs: float, window_secs: float = SPEECH_PACE_WINDOW_SECS
) -> float:
    """calculateSpeechPaceVariation: the sample SD of WPM over fixed windows, a
    segment's words shared between the windows it spans by overlap."""
    if not segments or duration_secs <= 0 or window_secs <= 0:
        return 0
    num_windows = math.ceil(duration_secs / window_secs)
    if num_windows < 2:
        return 0

    window_words = [0.0] * num_windows
    for segment in segments:
        start, end = segment["start"], segment["end"]
        if math.isnan(start) or math.isnan(end) or end <= start:
            continue
        words = word_count(segment["text"])
        if words == 0:
            continue
        for k in range(num_windows):
            w_start = k * window_secs
            w_end = min(duration_secs, (k + 1) * window_secs)
            overlap = max(0, min(end, w_end) - max(start, w_start))
            if overlap > 0:
                window_words[k] += words * (overlap / (end - start))

    wpm = []
    for k in range(num_windows):
        w_start = k * window_secs
        w_end = min(duration_secs, (k + 1) * window_secs)
        minutes = (w_end - w_start) / 60.0
        wpm.append(window_words[k] / minutes if minutes > 0 else 0)
    mean = sum(wpm) / num_windows
    return math.sqrt(sum((value - mean) ** 2 for value in wpm) / (num_windows - 1))


def format_srt_timestamp(seconds: float) -> str:
    ms = js_round(seconds * 1000)
    h, m, s = ms // 3600000, ms % 3600000 // 60000, ms % 60000 // 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms % 1000:03d}"


def transcript_to_srt(segments: list[dict]) -> str:
    return "\n".join(
        f"{index + 1}\n{format_srt_timestamp(s['start'])} --> "
        f"{format_srt_timestamp(s['end'])}\n{s['text']}\n"
        for index, s in enumerate(segments)
    )


def container_duration_secs(path: Path) -> float | None:
    """The duration a browser reads from the file's metadata, without decoding it."""
    try:
        with av.open(str(path), metadata_errors="ignore") as container:
            if container.duration is not None:
                return container.duration / av.time_base
    except (OSError, av.FFmpegError):
        pass
    return None


def first_positive(*values):
    """recordDurationTiers' answer: the first source with a duration above zero."""
    return next((value for value in values if (value or 0) > 0), None)


def build_record(
    conn: sqlite3.Connection, uploads: Path, row: dict, youtube: dict, base: Path
) -> tuple:
    """The manifest record and the files it links to, as {path: text}."""
    file_hash = row["hash"]
    results = {}
    for table in ("files", "transcripts", *STATS_COLUMNS):
        results[table] = conn.execute(
            f"SELECT * FROM {table} WHERE file_hash = ?", (file_hash,)
        ).fetchone()
    missing = [table for table, result in results.items() if result is None]
    if missing:
        raise ValueError(f"{row['title']} ({file_hash}) has no {', '.join(missing)}")
    if row["video_id"] not in youtube:
        raise ValueError(f"{row['title']} ({row['video_id']}) is in no YouTube report")

    youtube_content = youtube[row["video_id"]]
    stats = {
        table: {column: js_number(results[table][column]) for column in columns}
        for table, columns in STATS_COLUMNS.items()
    }
    video_path = uploads / f"{file_hash}.{results['files']['file_ext']}"
    file_duration = container_duration_secs(video_path) if video_path.exists() else None

    transcript = results["transcripts"]
    segments = json.loads(transcript["segments_json"])
    duration = first_positive(
        youtube_content["duration_secs"],
        stats["scene_stats"]["duration_secs"],
        file_duration,
        stats["audio_stats"]["duration_secs"],
    )
    transcript_path = f"transcript/{file_hash}.srt"
    files = {transcript_path: transcript_to_srt(segments)}

    retention_path = None
    if row.get("retention"):
        retention_csv = base / row["retention"]
        if not retention_csv.is_file():
            raise ValueError(f"{row['title']}: no retention export at {retention_csv}")
        retention_path = f"audience_retention/{file_hash}.json"
        files[retention_path] = json.dumps(parse_youtube_audience_retention_csv(retention_csv))

    provenance = {}
    for kind, table in (
        ("transcript", "transcripts"),
        ("transcript_stats", "transcripts"),
        ("scene_stats", "scene_stats"),
        ("text_stats", "text_stats"),
        ("audio_stats", "audio_stats"),
    ):
        result = results[table]
        provenance[kind] = {"producer": result["producer"]}
        if result["produced_at"]:
            provenance[kind]["produced_at"] = result["produced_at"]

    record = {
        "id": file_hash,
        "sort_name": row["title"],
        "video_file": {
            "hash": file_hash,
            "exists_on_server": True,
            "duration_secs": js_number(file_duration),
        },
        "youtube_content": youtube_content,
        "transcript_stats": {
            "count_chars": transcript["count_chars"],
            "count_words": transcript["count_words"],
            "speech_pace_variation": js_number(speech_pace_variation(segments, duration))
            if duration
            else None,
        },
        "scene_stats": stats["scene_stats"],
        "text_stats": stats["text_stats"],
        "audio_stats": stats["audio_stats"],
        "transcript_path": transcript_path,
        "video_file_path": None,
        "audience_retention_path": retention_path,
        "scan_provenance": provenance,
    }
    return record, files


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("out", type=Path, help="directory to write the export into")
    parser.add_argument(
        "--videos-csv", type=Path, required=True, help="hash, video_id, title per record"
    )
    parser.add_argument(
        "--youtube",
        type=Path,
        nargs="+",
        required=True,
        help="YouTube Studio Content report(s) (Table data.csv)",
    )
    parser.add_argument("--zip", type=Path, help="also write the export as this zip")
    parser.add_argument("--db", type=Path, default=Path(DB_PATH), help=f"default: {DB_PATH}")
    parser.add_argument(
        "--uploads", type=Path, default=Path(UPLOAD_FOLDER), help=f"default: {UPLOAD_FOLDER}"
    )
    args = parser.parse_args()

    youtube = {}
    for report in args.youtube:
        youtube.update(parse_youtube_content_csv(report))
    with open(args.videos_csv, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        built = [
            build_record(conn, args.uploads, row, youtube, args.videos_csv.parent) for row in rows
        ]
    except ValueError as error:
        parser.error(str(error))
    finally:
        conn.close()

    files = {path: text for _, record_files in built for path, text in record_files.items()}
    generated_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    manifest = {
        "generated_at": generated_at.replace("+00:00", "Z"),
        "records": [record for record, _ in built],
    }
    files["manifest.json"] = json.dumps(manifest, indent=2, ensure_ascii=False)

    for path, text in files.items():
        (args.out / path).parent.mkdir(parents=True, exist_ok=True)
        (args.out / path).write_text(text, encoding="utf-8")
    print(f"Wrote {len(built)} record(s) to {args.out}")

    if args.zip:
        # manifest.json at the root, as writeExportZip lays it out. Sorted, with a
        # fixed timestamp, so the same export makes the same zip.
        with zipfile.ZipFile(args.zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(files):
                info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(info, files[path].encode("utf-8"))
        print(f"Wrote {args.zip}")


if __name__ == "__main__":
    main()
