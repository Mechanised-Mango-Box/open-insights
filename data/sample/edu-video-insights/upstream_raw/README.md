# Upstream YouTube Studio exports

The raw YouTube Analytics data the four `../all_*.csv` files were distilled from,
copied unchanged from the upstream EduVideo Insights repository:

- Source: https://github.com/Mohamed-Tolba/edu-video-insights/tree/dcf3a6fd096b1dc38575b5709a1d3a09faf7df17/temp/Test_Data/raw
- Commit: `dcf3a6fd096b1dc38575b5709a1d3a09faf7df17` (2025-12-07)

| File | What it is |
|---|---|
| `MECH1750_1.csv` | One row per lecture (90): duration in minutes, views, and a 100-point audience-retention curve |
| `MECH1750_2.csv` | Studio "Content" report for the whole MECH1750 channel (194 videos + a `Total` row): real average view duration and average percentage viewed |
| `ENGG2240_1.csv` | As `MECH1750_1.csv` for the second course: 54 lectures plus 39 worked examples (`Type` = `WE`) |
| `ENGG2240_2.csv` | As `MECH1750_2.csv` for the second course's channel (267 videos + `Total`) |

`ENGG2240` is upstream's file name only. The `Unit` column inside says `ENGG2440`,
which matches the `newcastle_engg2440_...` dataset tag in `../all_*.csv`.

Every one of the 144 videos in `../all_train_dataset.csv` appears in both files for
its course, and `Average percentage viewed (%)` in the `_2` files equals
`../all_metrics.csv` exactly. `model_training/compare_upstream.py` checks this; see
`../COMPARISON.md`.
