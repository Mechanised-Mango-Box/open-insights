#!/usr/bin/env python3
"""Rebuild the upstream YouTube Studio export this dataset was distilled from.

The four all_*.csv files here were imported from an earlier iteration of the
project; the YouTube-side export they came from is gone. This reconstructs it into
../edu-video-insights-recreated_raw/ so the dataset can go back through the app's
normal YouTube import path.

Nothing here is invented. Every value is either copied from the source CSVs or is
arithmetic over them, so the export carries exactly the information the dataset
already held and no more. Concretely, a Studio "Content" report per channel (an
export is per-channel, and this dataset spans two):

    <dataset_tag>/Content <range> <channel>/Table data.csv

Layout and column spelling follow the real exports in ../mock-v3/. Only the six
columns the source data determines are present:

    Content                        <- all_metadata.video_id
    Video title                    <- all_metadata.title
    Video publish time             <- all_metadata.published_at
    Duration                       <- all_characs.duration_min x 60
    Average view duration          <- Duration x APV / 100
    Average percentage viewed (%)  <- all_metrics.average_percentage_viewed, verbatim

Studio's Advanced mode lets you choose which metrics an export carries, so a
six-column export is a shape it really produces. Views, watch time, subscribers,
impressions and click-through rate are absent because the source CSVs do not
contain them and there is no way to derive them - they are left out rather than
blanked or filled in.

There are no audience-retention reports for the same reason. Retention is a
per-segment measurement; the source data holds one scalar per video
(average_percentage_viewed) and nothing about the shape of the curve behind it.
Any curve consistent with that scalar would be a fabrication with twenty invented
degrees of freedom, so none is written.

Two notes on the arithmetic, neither of which adds information:

  - duration_min is stored to 2 dp, so Duration recovers the true length only to
    within +/-0.3s.
  - Average view duration must be a whole number of seconds, so re-deriving APV
    from avd_secs / duration_secs lands ~0.1pp out on a 10-minute lecture and
    ~0.5pp out on the shortest one here. The Average percentage viewed (%) column
    is verbatim, so the exact value survives; only that derived path is lossy.

Run with /usr/bin/python3 (plain python3 on this machine is a broken shim).
"""
import csv
import sys
from pathlib import Path

BASE = Path(__file__).parent
OUT = BASE.parent / "edu-video-insights-recreated_raw"

# Spelling and order follow ../mock-v3/Content FAKE_DATE_RANGE USERNAME/Table
# data.csv, minus the columns this dataset cannot fill, plus the Advanced-mode
# metric its target came from.
CONTENT_HEADER = (
    "Content,Video title,Video publish time,Duration,"
    "Average view duration,Average percentage viewed (%)"
)


def read_csv(name):
    with (BASE / name).open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def fmt_clock(secs):
    """Studio's "H:MM:SS" average view duration - it keeps the hours part at zero."""
    return f"{secs // 3600}:{(secs % 3600) // 60:02d}:{secs % 60:02d}"


def fmt_publish_time(iso):
    """all_metadata's "2021-06-29T10:55:13Z" as Studio's "2021-06-29 10:55:13"."""
    return iso.replace("T", " ").rstrip("Z")


def main():
    metadata = {(r["dataset_tag"], r["video_id"]): r for r in read_csv("all_metadata.csv")}
    characs = {(r["dataset_tag"], r["video_id"]): r for r in read_csv("all_characs.csv")}
    metrics = read_csv("all_metrics.csv")

    # A video missing from any one of the three is a broken dataset, not a row to skip.
    for row in metrics:
        key = (row["dataset_tag"], row["video_id"])
        for name, table in (("all_metadata.csv", metadata), ("all_characs.csv", characs)):
            if key not in table:
                sys.exit(f"{key[1]} is in all_metrics.csv but not {name}")

    by_tag = {}

    for row in metrics:
        tag, vid = row["dataset_tag"], row["video_id"]
        meta, chars = metadata[(tag, vid)], characs[(tag, vid)]
        apv_text = row["average_percentage_viewed"]  # verbatim, no float round trip

        duration_secs = round(float(chars["duration_min"]) * 60)
        avd_secs = round(duration_secs * float(apv_text) / 100)

        group = by_tag.setdefault(
            tag, {"channel": meta["channel_name"], "year": meta["year"], "rows": []}
        )
        group["rows"].append({
            "video_id": vid,
            "title": meta["title"],
            "published": fmt_publish_time(meta["published_at"]),
            "duration_secs": duration_secs,
            "avd": fmt_clock(avd_secs),
            "apv": apv_text,
        })

    for tag, group in by_tag.items():
        # Studio names a report for the window it covers; the dataset tag and the
        # metadata agree on the year, and the videos themselves are older.
        date_range = f"{group['year']}-01-01_{group['year']}-12-31"
        rows = group["rows"]
        # Studio sorts by the leading metric, which here would be views - a column
        # this export does not have. Publish time descending is one of its own
        # orderings and needs nothing the source data lacks.
        rows.sort(key=lambda r: r["published"], reverse=True)

        content_dir = OUT / tag / f"Content {date_range} {group['channel']}"
        content_dir.mkdir(parents=True, exist_ok=True)
        # Written by hand rather than via csv.writer so the quoting matches the real
        # export: the three text columns are always quoted, every other column is
        # bare (including the H:MM:SS average view duration).
        with (content_dir / "Table data.csv").open("w", newline="", encoding="utf-8") as fh:
            fh.write(CONTENT_HEADER + "\n")
            for r in rows:
                title = r["title"].replace('"', '""')
                fh.write(
                    f'"{r["video_id"]}","{title}","{r["published"]}",'
                    f'{r["duration_secs"]},{r["avd"]},{r["apv"]}\n'
                )

        print(f"{tag}: {len(rows)} rows in 'Content {date_range} {group['channel']}'")

    # Every column is copied or derived, so the check is that nothing drifted.
    source = {r["video_id"]: r["average_percentage_viewed"] for r in metrics}
    checked = 0
    for group in by_tag.values():
        for r in group["rows"]:
            if r["apv"] != source[r["video_id"]]:
                sys.exit(f"{r['video_id']}: APV not verbatim from all_metrics.csv")
            h, m, s = (int(p) for p in r["avd"].split(":"))
            if h * 3600 + m * 60 + s != round(r["duration_secs"] * float(r["apv"]) / 100):
                sys.exit(f"{r['video_id']}: average view duration inconsistent")
            checked += 1
    print(f"{checked} videos checked: every value copied or derived from the source CSVs")


if __name__ == "__main__":
    main()
