# Sample data

The 144 lectures of the EduVideo Insights dataset (two Newcastle courses, MECH1750 and
ENGG2440), in two forms: the files YouTube Studio hands over, and an export of the same
records with every Scan result, ready to import.

| Path | What it is |
|---|---|
| `edu-video-insights-recreated_raw/<course>/Content <range> <channel>/Table data.csv` | Studio content report per channel: title, duration, average view duration |
| `edu-video-insights-recreated_raw/<course>/Audience retention <range> <title>/All.csv` | Studio audience retention export per video (100 points) |
| `edu-video-insights-export.zip` | An export of all 144 records: YouTube figures, transcripts, all four Scan results and retention. No video files. |
| `edu-video-insights-export/` | The same export unzipped, so changes show up in a diff |
| `edu-video-insights/videos.csv` | Which video file is which: SHA-256, YouTube id, course, title, retention file |
| `edu-video-insights/` | The source data (`all_*.csv`, `upstream_raw/`), the scripts that wrote the Studio files, and `COMPARISON.md` |

Nothing in the Studio files is invented. The content reports are rebuilt from `all_*.csv`
by `gen_youtube_exports.py`. The retention exports are upstream's real curves, reformatted
by `gen_retention_exports.py`. The export is built by `server/scripts/build_export.py`
from a server that scanned the videos (see its docstring).

There are no videos, because they aren't ours to redistribute. There are no YouTube
captions either: they were never collected. The transcripts in the export come from Scan.

## A full test

**From the Studio files** (the Import step):

1. Import both `Table data.csv` files. That gives 144 records with YouTube figures.
2. To test Scan, get some of the videos. If you own the channel, use Studio's download.
   For personal testing, the YouTube ids are in the `Content` column. Import them and
   use **Auto-Merge** to pair them with the report rows, then **Scan**. A file whose
   SHA-256 matches `videos.csv` is byte-identical to the one the export was scanned
   from. Other copies give slightly different results.
3. Use a record's **Edit** to attach its `All.csv`.

**From the export** (everything after Import):

1. Import `edu-video-insights-export.zip`. That gives 144 records with every result.
2. **Analysis**: all 144 records are usable. **Recommend**: works on any record without
   its video, since the features are sent from the browser.
3. **Export**, then import the export again to check the round trip.
4. Train on it:
   ```sh
   cd server
   python scripts/train_engagement_model.py ../data/sample/edu-video-insights-export.zip \
     --feature-set lite --out /tmp/lite
   ```
   The metrics should match `models/lite/model.json`, which was trained on the same
   records.

`client/src/app/data-management/video-records/sample-data.spec.ts` checks that the zip
and the Studio files still import.

## Regenerating

```sh
/usr/bin/python3 data/sample/edu-video-insights/gen_youtube_exports.py
/usr/bin/python3 data/sample/edu-video-insights/gen_retention_exports.py
cd server && python scripts/build_export.py ../data/sample/edu-video-insights-export \
  --videos-csv ../data/sample/edu-video-insights/videos.csv \
  --youtube ../data/sample/edu-video-insights-recreated_raw/*/Content*/"Table data.csv" \
  --zip ../data/sample/edu-video-insights-export.zip
```

`build_export.py` needs a server database that has scanned all 144 videos.
