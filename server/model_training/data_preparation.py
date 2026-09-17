"""
Data Preparation Module for Model Training.

Turns a client export (the `open-insights-export-<timestamp>` zip, or that zip
unpacked into a folder) into the table the models train on: one row per video,
FEATURE_COLUMNS plus TARGET_COLUMN.

Only the export's manifest.json is read. The transcripts and video files beside
it are not needed - Scan already reduced them to the stats the manifest carries -
so an export made with or without video files trains the same model.

The features are computed exactly as the client's Analysis page computes them
(buildVideoFeatures / AnalysisService.buildFeatureRows in
client/src/app/data-management/analysis/analysis.service.ts), because the server
scores features the client sends it: a model trained on differently-derived
numbers would be scoring inputs it never saw.

    duration               scene_stats.duration_secs / 60        (minutes)
    wpm                    count_words / duration
    scene_change_rate      scenes / duration                      (per minute)
    word_count             count_words
    speech_pace_variation  transcript_stats, as-is                (WPM std dev)
    speaking_ratio         transcript_stats, as-is                (0-1)
    average_percentage_viewed
                           average_view_duration_secs / scene_stats.duration_secs * 100

A record is skipped, as the client skips it, when its scene or transcript stats
are missing, its duration is not positive, its speech features are null (Scan had
no duration to measure them against), or it has no YouTube average view duration.
"""
import json
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

# Standard Feature and Target Definitions
FEATURE_COLUMNS: List[str] = [
    "duration",
    "wpm",
    "scene_change_rate",
    "word_count",
    "speech_pace_variation",
    "speaking_ratio",
]

TARGET_COLUMN: str = "average_percentage_viewed"

# Below this there is too little to split 80/20 and still fit six features.
MIN_TRAINING_ROWS = 10


def _read_manifest(path: Path) -> Dict[str, Any]:
    if path.is_dir():
        manifest_path = path / "manifest.json"
        if not manifest_path.is_file():
            raise ValueError(f"{path} is not an export: manifest.json is missing.")
        return json.loads(manifest_path.read_text(encoding="utf-8"))

    if path.is_file() and zipfile.is_zipfile(path):
        # Only the manifest is opened, so the video files an export may carry are
        # never read - an export of a whole library runs to gigabytes.
        with zipfile.ZipFile(path) as archive:
            try:
                return json.loads(archive.read("manifest.json").decode("utf-8"))
            except KeyError:
                raise ValueError(f"{path} is not an export: manifest.json is missing.") from None

    raise ValueError(f"{path} is neither an export folder nor an export .zip.")


def _record_to_row(record: Dict[str, Any]) -> Tuple[Optional[Dict[str, float]], Optional[str]]:
    """The training row for one manifest record, or None and the reason it was skipped."""
    scene_stats = record.get("scene_stats")
    transcript_stats = record.get("transcript_stats")
    if not scene_stats or not transcript_stats:
        return None, "missing scene or transcript stats"

    duration_secs = scene_stats.get("duration_secs") or 0
    if duration_secs <= 0:
        return None, "no positive duration"

    speech_pace_variation = transcript_stats.get("speech_pace_variation")
    speaking_ratio = transcript_stats.get("speaking_ratio")
    if speech_pace_variation is None or speaking_ratio is None:
        return None, "speech features not measured"

    average_view_duration_secs = (record.get("youtube_content") or {}).get(
        "average_view_duration_secs"
    )
    if average_view_duration_secs is None:
        return None, "no YouTube average view duration"

    duration_mins = duration_secs / 60
    count_words = transcript_stats["count_words"]
    return {
        "duration": duration_mins,
        "wpm": count_words / duration_mins,
        "scene_change_rate": scene_stats["scenes"] / duration_mins,
        "word_count": count_words,
        "speech_pace_variation": speech_pace_variation,
        "speaking_ratio": speaking_ratio,
        TARGET_COLUMN: average_view_duration_secs / duration_secs * 100,
    }, None


def load_export_dataset(path: str | Path, verbose: bool = True) -> pd.DataFrame:
    """
    Loads a client export (folder or .zip) as a training DataFrame.

    Raises ValueError when the path is not an export, or when fewer than
    MIN_TRAINING_ROWS of its records have everything a training row needs.
    """
    path = Path(path)
    manifest = _read_manifest(path)
    records = manifest.get("records")
    if not isinstance(records, list):
        raise ValueError(f"{path}: manifest.json is malformed - no records array.")

    rows: List[Dict[str, float]] = []
    skipped: Counter = Counter()
    for record in records:
        row, reason = _record_to_row(record)
        if row is None:
            skipped[reason] += 1
        else:
            rows.append(row)

    if verbose:
        print(f"[ Data ] {path.name}: {len(rows)} of {len(records)} record(s) usable for training.")
        for reason, count in skipped.most_common():
            print(f"  skipped {count}: {reason}")

    if len(rows) < MIN_TRAINING_ROWS:
        raise ValueError(
            f"{path}: only {len(rows)} usable record(s), need at least {MIN_TRAINING_ROWS}. "
            "Run Scan (transcript, transcript stats, scene stats) and import the YouTube "
            "content report for more videos, then export again."
        )

    return pd.DataFrame(rows, columns=FEATURE_COLUMNS + [TARGET_COLUMN])


def prepare_training_data(raw_df: pd.DataFrame) -> pd.DataFrame:
    """
    Validates a training DataFrame and narrows it to the feature and target columns.
    Load one from an export with load_export_dataset().
    """
    required_cols = FEATURE_COLUMNS + [TARGET_COLUMN]
    missing = [col for col in required_cols if col not in raw_df.columns]
    if missing:
        raise ValueError(f"Missing required columns in dataset: {missing}")
    return raw_df[required_cols].dropna()
