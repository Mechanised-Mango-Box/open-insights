#!/usr/bin/env python3
"""Write each lecture's audience retention as YouTube Studio exports it.

gen_youtube_exports.py rebuilds the channel "Content" reports and writes no
retention, because all_*.csv hold nothing about the shape of the curve. The
curves did survive upstream: upstream_raw/*_1.csv carry a 100-point retention
curve for every one of the 144 videos. This writes each one into
../edu-video-insights-recreated_raw/ beside its course's Content report, in the
layout of Studio's per-video export (Analytics -> Engagement -> Audience
retention -> See more -> Export current view):

    <dataset_tag>/Audience retention <range> <title>/All.csv

    Video position (%),Absolute audience retention (%)
    0,108.79
    1,91.33
    ...

Nothing here is invented, and only the format changes:

    Video position (%)              <- the point's index, 0-99
    Absolute audience retention (%) <- the upstream value x 100, digit for digit

Upstream writes retention as a fraction of views (1.0879: rewatching makes the
opening pass 100%), Studio as a percentage. The x 100 is a decimal shift on the
text, not a float round trip, so every digit upstream wrote survives.

Titles are all_metadata's. A '/' cannot go in a folder name, nor a ':' on
Windows, so each becomes '-', as in the yt-dlp file names the videos were
downloaded under.

videos.csv's `retention` column - which file is which video, for
server/scripts/build_export.py - is rewritten here too, since this is what names
the files.

Run with /usr/bin/python3 (plain python3 on this machine is a broken shim).
"""
import csv
import sys
from decimal import Decimal
from pathlib import Path

BASE = Path(__file__).parent
OUT = BASE.parent / "edu-video-insights-recreated_raw"
UPSTREAM = ("MECH1750_1.csv", "ENGG2240_1.csv")
VIDEOS_CSV = BASE / "videos.csv"

RETENTION_HEADER = "Video position (%),Absolute audience retention (%)"


def read_csv(path):
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def parse_curve(text):
    """Upstream's "[1.0879; 0.9133; ...]" as the decimal strings it holds."""
    return [part.strip() for part in text.strip().strip("[]").split(";")]


def as_percent(fraction):
    """'1.0879' -> '108.79', '0.70' -> '70', exactly."""
    text = format(Decimal(fraction).scaleb(2), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def main():
    metadata = {r["video_id"]: r for r in read_csv(BASE / "all_metadata.csv")}
    wanted = {r["video_id"] for r in read_csv(BASE / "all_metrics.csv")}

    curves = {}
    for name in UPSTREAM:
        for row in read_csv(BASE / "upstream_raw" / name):
            if row["Video"] in wanted:
                curves[row["Video"]] = parse_curve(row["Retention"])

    missing = wanted - curves.keys()
    if missing:
        sys.exit(f"no upstream retention for {', '.join(sorted(missing))}")

    paths = {}
    for vid in sorted(wanted):
        meta, curve = metadata[vid], curves[vid]
        if len(curve) != 100:
            sys.exit(f"{vid}: {len(curve)} retention points, not 100")
        # The same window as the Content report beside it (gen_youtube_exports.py).
        date_range = f"{meta['year']}-01-01_{meta['year']}-12-31"
        title = meta["title"].replace("/", "-").replace(":", "-")
        out_dir = OUT / meta["dataset_tag"] / f"Audience retention {date_range} {title}"
        out_dir.mkdir(parents=True, exist_ok=True)
        with (out_dir / "All.csv").open("w", newline="", encoding="utf-8") as fh:
            fh.write(RETENTION_HEADER + "\n")
            for position, value in enumerate(curve):
                fh.write(f"{position},{as_percent(value)}\n")
        paths[vid] = (out_dir / "All.csv").relative_to(BASE.parent)

    # Read back what was written, so the check covers the files, not the plan.
    for vid, path in paths.items():
        rows = read_csv(BASE.parent / path)
        if [Decimal(r["Absolute audience retention (%)"]) for r in rows] != [
            Decimal(v) * 100 for v in curves[vid]
        ] or [int(r["Video position (%)"]) for r in rows] != list(range(100)):
            sys.exit(f"{vid}: {path} does not match upstream")
    print(f"{len(paths)} retention exports written and checked against upstream_raw/")

    if VIDEOS_CSV.exists():
        rows = read_csv(VIDEOS_CSV)
        fields = [f for f in rows[0] if f != "retention"] + ["retention"]
        for row in rows:
            # Relative to videos.csv, which is how build_export.py resolves it.
            row["retention"] = Path("..", paths[row["video_id"]]).as_posix()
        with VIDEOS_CSV.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        print(f"{len(rows)} rows of videos.csv point at them")


if __name__ == "__main__":
    main()
