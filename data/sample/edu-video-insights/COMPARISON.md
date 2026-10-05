# Open Insights vs EduVideo Insights and its paper

This compares three sets of results for the same 144 lecture videos (MECH1750, 90;
ENGG2440, 54):

| Source | What it is |
|---|---|
| **Paper** | Tolba, Kendall, Tudball Smith, Gregg, Vo & Wordley, *An Open Workflow Model for Improving Educational Video Design: Tools, Data, and Insights*, AAEE 2025 (arXiv 2512.16254). Numbers as printed in Figure 5 and the Stage 5 text. |
| **Upstream** | The paper's code and data, [github.com/Mohamed-Tolba/edu-video-insights](https://github.com/Mohamed-Tolba/edu-video-insights). Its `data/all_*.csv` are copied into this folder, and its original YouTube Studio exports are in [`upstream_raw/`](upstream_raw/README.md). Everything is re-run here. |
| **This project** | The same videos scanned by Open Insights and exported as `open-insights-export-2026-09-17T10_51_24.250Z`. Screen text was added afterwards by running the server's OCR (`server/text_stats.py`) over the same video files, and the one AV1 video's scene count, which that export has as 0, was recomputed once scene stats could decode it (see [Scene count](#do-the-two-pipelines-measure-the-same-thing)). That gives the `…-text` copy of the export. Audio stats were then added the same way, by running the server's `calculate_audio_stats` (`server/audio_stats.py`) over the same files, giving the `…-text-audio` copy. The committed engagement model was trained on the `…-text-audio` copy. |

All numbers below come from
[`server/model_training/compare_upstream.py`](../../../server/model_training/compare_upstream.py).
See [Reproducing](#reproducing) for how to run it.

## Summary

- **The paper reproduces exactly.** Upstream's own gradient descent on `all_train_dataset.csv`
  gives the paper's weights (−21.81, 20.52, −3.04, −1.02, 1.15), RMSE 8.60 and R² 0.0853.
- **Duration, word count and speaking speed agree.** Duration is identical. Word counts differ by
  4.7 words on average, even though the two projects use different Whisper models.
- **Scene counts do not agree.** This project counts more scenes in 136 of the 144 videos (median
  +2, correlation 0.88), because its scene detector works differently.
- **The target is the same number in both.** The average percentage viewed that upstream used
  equals YouTube Studio's figure for all 144 videos. This project's target comes within 0.71 pp of
  it. It is not independent evidence, though: it was rebuilt from upstream's values.
- **The paper's correlations reproduce.** Run on this project's data, they match the paper to two
  decimal places for duration and word count. Only the scene features move.
- **The paper's "unexpected" positive word-count weight also shows up here (+14.2).** Duration and
  word count correlate at 0.987 (variance inflation factor ~180 each). The two weights are
  offsetting each other, not showing a real effect.
- **This project's extra speech features add signal in-sample.** Speech pace variation has
  r = −0.21, speech ratio r = +0.17 and mean pause length r = −0.30, the strongest of any speech
  feature. With them, R² on the training data goes from 0.078 to 0.21. See
  [Speech ratio and pauses](#speech-ratio-and-pauses).
- **Text density (words on screen, by OCR) adds almost nothing.** More text goes with slightly
  less watching (r = −0.10; rank correlation −0.21), but its in-sample weight in the 8-feature
  model is −0.02.
- **Still, no model predicts engagement on videos it hasn't seen with any confidence.** Under
  repeated 5-fold cross-validation the best model scores RMSE 8.37 ± 1.82, against 9.00 ± 1.42 for
  simply predicting the average, a gain well inside the fold-to-fold SD. The shipped model's
  reported score (RMSE 6.68, R² 0.20) comes from one 29-video test set. It can't be compared with
  the paper's in-sample 8.6 / 0.085.

## How each feature is measured

| Feature | Upstream | This project |
|---|---|---|
| Duration | OpenCV frame count ÷ fps | OpenCV frame count ÷ fps |
| Word count | openai-whisper `base`, with bracketed tags like `[music]` removed, split on whitespace | faster-whisper `tiny.en` (int8), with segments joined and split on whitespace |
| Speaking speed (wpm) | words ÷ minutes | words ÷ minutes |
| Scene count | PySceneDetect `ContentDetector(threshold=30)`, counting *scenes* and dropping any that start in the first 1 s or end in the last 2 s | Counts every frame whose grayscale mean absolute difference from the previous frame exceeds 30 |
| Scene change rate | scenes ÷ minutes | scenes ÷ minutes |
| Text density | Not measured | RapidOCR (PP-OCRv6 small) on one frame every 5 s. Counts words (tokens with at least two letters or digits) from lines read with confidence ≥ 0.8, averaged over the video |
| Speech ratio | Not measured | Silero VAD on the 16 kHz audio, ending speech at a 250 ms silence and padding it by 30 ms. Seconds of speech ÷ duration |
| Mean pause | Not measured | The same VAD pass. Mean gap between consecutive stretches of speech, in seconds |
| Average percentage viewed | YouTube Analytics average percentage viewed, copied by hand | Average view duration ÷ duration × 100, taken from the Studio report that [`gen_youtube_exports.py`](gen_youtube_exports.py) rebuilt from upstream's data |

## Do the two pipelines measure the same thing?

Differences below are this project's value minus upstream's, for each video.

| Feature | r | Mean diff | Mean \|diff\| | Max \|diff\| |
|---|---|---|---|---|
| Duration (min) | 1.000 | 0.000 | 0.003 | 0.005 |
| Word count | 1.000 | −0.19 | 4.69 | 25 |
| Speaking speed (wpm) | 0.993 | −0.08 | 1.12 | 7.8 |
| Scene count | 0.883 | +4.24 | 4.26 | 62 |
| Scene change rate (per min) | 0.812 | +1.12 | 1.12 | 39.4 |
| Average percentage viewed (pp) | 1.000 | +0.01 | 0.14 | 0.71 |

- **Duration.** Both projects use the same OpenCV calculation, so any difference is only upstream's
  rounding to 2 dp.
- **Word count.** A smaller Whisper model gives almost the same count: 10 videos match exactly and
  124 are within 1%. The largest gap is 25 words, on `QgvNlgWubKk` (1226 vs 1201).
- **Scene count.** This is the one real difference.
  - This project counts more in 136 videos, the same in 7 and fewer in 1.
  - Upstream finds no scene change at all in 18 videos. This project finds none in 2.
  - The large gaps are short videos with a lot of motion. For example, `yytmPfR8Hr8` is a
    1.6-minute video where upstream finds 22 scenes and this project finds 84 (53 per minute).
    `stNOqGDYej4` has 35 vs 90, and `HKSdW1aHM0w` has 21 vs 61.
  - The cause is how each method works. A frame-to-frame pixel difference fires on every fast
    change, so an animation or camera move can count many times. PySceneDetect's content score
    and its minimum scene length absorb those changes.
  - **`32SoHr3odY0` used to be a zero, from a bug.** It is encoded as AV1, which the
    opencv-python wheels decode only in hardware. On a machine without that, every frame read
    failed, but the duration still came from the file's metadata, so scene stats quietly
    recorded 0 scenes. Scene stats now falls back to PyAV when OpenCV decodes nothing, and counts
    12 where upstream finds 11. Every number here uses the 12.

## Where the target comes from

Each row compares two ways of getting average percentage viewed, video by video. Differences are
b − a.

| a | b | Equal to 2 dp | Mean diff | Mean \|diff\| | Max \|diff\| |
|---|---|---|---|---|---|
| Upstream APV (`all_metrics.csv`) | Studio APV | 144 / 144 | 0.000 | 0.000 | 0.000 |
| Upstream APV | Studio average view duration ÷ Studio duration | 2 / 144 | −0.21 | 0.21 | 0.91 |
| Upstream APV | This project's target | 4 / 144 | +0.01 | 0.14 | 0.71 |
| Studio average view duration ÷ Studio duration | This project's target | 0 / 144 | +0.22 | 0.27 | 0.98 |
| Upstream APV | Mean of the 100-point retention curve | 0 / 144 | +10.88 | 11.02 | 17.29 |

- **Upstream copied YouTube's APV exactly.** The paper's target is the real Studio figure for
  every video.
- **This project's target is within 1 pp of it for every video.** The target's SD is 9 pp, so this
  gap is negligible. It is still not an independent measurement, because
  `gen_youtube_exports.py` rebuilt the Studio report from upstream's APV. What the vendored raw
  data now confirms is that importing the *real* Studio report would give nearly the same numbers.
  Its AVD ÷ duration sits within 0.91 pp of APV, and Studio's own duration is within 0.02 minutes
  of the OpenCV one.
- **The retention curves are not a substitute for APV.** Their mean runs about 11 pp above it
  (r = 0.96), and 141 of the 144 start above 100%. That looks like rewatches or a different
  normalisation. This matters if the curves are ever imported as audience-retention data.

## Exploratory analysis vs the paper

### Correlation with average percentage viewed (paper Figure 5)

| Feature | Paper | Upstream data | This project |
|---|---|---|---|
| Duration | −0.23 | −0.233 | −0.234 |
| Word count | −0.22 | −0.221 | −0.222 |
| Speaking speed | −0.03 | −0.034 | −0.020 |
| Scene count | −0.01 | −0.014 | +0.043 |
| Scene change rate | +0.09 | +0.094 | +0.123 |
| Speech pace variation | — | — | −0.206 |
| Text density | — | — | −0.104 |
| Speech ratio | — | — | +0.174 |
| Mean pause | — | — | −0.302 |

- **Duration, word count and speaking speed** are the same within 0.015.
- **Scene count changes sign**, but it was around zero in both, so neither reading says anything.
- **Speech pace variation** has the third-strongest correlation of any feature in either project.
  The paper didn't measure it.

### Distributions (paper Figure 4)

- **Where they agree.** Duration, word count and APV have the same shape in both. The paper's
  descriptions hold for both datasets:
  - The median duration is 4.3 minutes.
  - Speaking speed is centred on 205 wpm, with an interquartile range of 198–213.
  - 84% of APV values fall between 60% and 90%, and the middle half between 65% and 75%.
- **Where they differ.** This project's scene distributions sit higher:
  - Scene count: median 8 vs 5.5, upper quartile 15 vs 13.
  - Scene change rate: median 1.8 vs 1.3 per minute, max 53 vs 14.
  - The paper says most videos have fewer than 15 scenes and fewer than 4 scene changes per
    minute. That holds for 81% and 86% of videos with upstream's counts, and 72% and 79% with
    this project's.

### LOESS (paper Figure 6)

Using upstream's smoothing fraction (0.3):

- **Duration, word count and speaking speed:** the curves for the two datasets lie on top of each
  other. Both show the paper's shape: engagement falls as videos get longer, and speaking speed
  peaks at moderate values.
- **Scene count and scene change rate:** the curves split apart at the tails, driven by the handful
  of high-motion videos above.

This project's LOESS is a local-linear tricube fit, `compute_loess` in
[`data_analysis.py`](../../../server/model_training/data_analysis.py). It skips the robustness
iterations of statsmodels' `lowess`, which upstream used, so its curves are a little wigglier than
the paper's.

## Models

There are three evaluation protocols, and the headline numbers from each project don't use the
same one:

- **Paper protocol.** Features are z-scored over all 144 videos, a linear regression is fitted,
  and it is scored on the same 144 videos (in-sample). This is what the paper's 8.6 / 0.0853
  measures.
- **Project protocol.** `train.py` makes one 80/20 split with `random_state=42` and scores on the
  29 held-out videos. The shipped 6.68 / 0.20 comes from this.
- **Cross-validation.** Repeated 5-fold cross-validation, 10 repeats and 50 folds, scored on
  held-out folds. Of the three, this is the only one that estimates how the model does on new
  videos.

### Paper protocol (in-sample)

Weights are percentage points of APV per standard deviation of each feature.

| Run | Duration | Words | wpm | Scenes | Scene rate | Pace var. | Text density | Speech ratio | Mean pause | RMSE | R² |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Paper, as printed | −21.81 | 20.52 | −3.04 | −1.02 | 1.15 | — | — | — | — | 8.6 | 0.0853 |
| Upstream data, upstream's gradient descent | −21.81 | 20.52 | −3.04 | −1.02 | 1.15 | — | — | — | — | 8.603 | 0.0853 |
| Upstream data, exact least squares | −22.01 | 20.73 | −3.07 | −1.03 | 1.15 | — | — | — | — | 8.603 | 0.0854 |
| This project, paper's 5 features | −16.05 | 14.20 | −2.24 | 0.31 | 0.34 | — | — | — | — | 8.651 | 0.0780 |
| This project, model's 8 features (143 videos) | −14.86 | 13.21 | −3.67 | — | 0.61 | −1.65 | −0.02 | −0.92 | −3.61 | 7.994 | 0.2136 |

- **The paper's weights come from upstream's gradient descent, not exact least squares.** They
  are reproduced by upstream's `gradient_descent` in
  [`core/regression_core.py`](https://github.com/Mohamed-Tolba/edu-video-insights/blob/dcf3a6fd096b1dc38575b5709a1d3a09faf7df17/core/regression_core.py),
  run with the settings in `scripts/model_data.py`: step size α = 0.9, 2000 iterations, starting
  from zero. It stops just short of the exact least-squares solution, because the near-collinear
  features make the descent slow. `regression_core.py`'s own example uses α = 0.92, which diverges
  on this data.
- **The same protocol on this project's features gives nearly the same fit (R² 0.078 vs 0.085).**
  The duration and word-count weights still come out large and opposite-signed. Both scene weights
  are close to zero in both projects.

### Why word count gets a positive weight

The paper found it "contrary to initial assumptions" that word count has a positive weight when its
correlation with engagement is negative. The cause is collinearity:

| Feature set | Duration VIF | Word count VIF | Others |
|---|---|---|---|
| Upstream, paper's 5 features | 187 | 199 | 4.7–5.7 |
| This project, paper's 5 features | 179 | 189 | 3.7–4.7 |
| This project, model's 8 features | 177 | 180 | 1.1–4.9 |

- **Duration and word count carry almost the same information.** Words ≈ wpm × duration, and the
  two correlate at r = 0.987. A variance inflation factor near 180 means the data barely
  constrains either weight separately. The regression puts a large negative weight on one and a
  large positive weight on the other, and the two mostly cancel.
- **The weights are unstable.** The ~5-word differences between Whisper models were enough to move
  both weights by about 6 points, while R² barely changed.
- **Only their combined effect can be read, and that is "longer is worse."** Neither weight
  means anything on its own.

**This matters for the app.** `inference.py` turns each linear weight above ±1 into advice. The
shipped model's word-count weight is +11.4, so it tells a short video to *add words*, while telling
long videos to cut duration. That advice is an artefact of the collinearity. The fix is to
drop one of the pair or combine them, for example by keeping duration and wpm, since word count is
their product. That is a modelling change, and this comparison doesn't make it.

### Project protocol (train.py's split, the same 29 held-out videos for every row but the last)

| Run | Linear RMSE | Linear R² | Forest RMSE | Forest R² | Mean-predictor RMSE |
|---|---|---|---|---|---|
| Upstream data, paper's 5 features | 6.99 | 0.108 | 7.81 | −0.111 | 7.41 |
| This project, paper's 5 features | 7.07 | 0.094 | 7.32 | 0.027 | 7.42 |
| This project, model's 8 features (shipped) | 6.68 | 0.202 | 6.84 | 0.164 | 7.62 |

- **The last row is what `python -m model_training.train` reports for the committed model.** It
  trains on 143 videos (one has no pause to measure; see below), so its 80/20 split holds out a
  different 29, on which the average scores 7.62 rather than 7.42.
- **These RMSEs are lower than the paper's 8.6 because the test set is easier, not because the
  model is better.** Predicting the average scores 7.4 on these 29 videos, against 9.0 across all
  144.
- **On the same split, upstream's data scores slightly better than this project's.** One 29-video
  split is too noisy to rank the rows, which is why the next table uses cross-validation.

### Cross-validation (repeated 5-fold, 10 repeats; mean ± SD over 50 folds)

| Run | Linear RMSE | Forest RMSE | Mean-predictor RMSE | Linear R² | Forest R² |
|---|---|---|---|---|---|
| Upstream data, paper's 5 features | 8.94 ± 1.51 | 9.88 ± 1.54 | 8.96 ± 1.43 | −0.058 ± 0.176 | −0.301 ± 0.232 |
| This project, paper's 5 features | 9.09 ± 1.49 | 9.57 ± 1.66 | 8.98 ± 1.44 | −0.100 ± 0.237 | −0.210 ± 0.221 |
| This project, model's 8 features (143 videos) | 8.37 ± 1.82 | 8.84 ± 1.68 | 9.00 ± 1.42 | +0.087 ± 0.169 | −0.031 ± 0.200 |

The mean predictor's own R² averages −0.057 over these folds. It uses the training fold's mean, so
it scores a little below zero on each test fold.

- **The paper's five features predict engagement no better than the average, with either
  project's data.** The random forest does worse than the average.
- **Only the model's 8 features beat the average, and only just.** Its linear RMSE is 8.37
  against 9.00, 0.6 pp (7%) lower, still inside the fold-to-fold SD of 1.8. The forest beats the
  average by less (8.84).
- **The paper's in-sample R² of 0.085 does not carry over to new videos.** This matches its own
  closing caution that "these results should serve primarily as exploratory indicators."

### Text density (on-screen text)

Words on screen, read by OCR from one frame every 5 seconds and averaged over the video:

| | Min | Q1 | Median | Q3 | Max |
|---|---|---|---|---|---|
| Words on screen | 0.3 | 4.0 | 7.6 | 12.0 | 218 |

- **Most of these lectures carry little text.** The median is under 8 words on screen.
  - A talking-head shot still reads 1–3 "words", from the lecturer's shirt logos.
  - The top of the range is software screen recordings, where a whole application window is on
    screen: GRANTA EduPack menus, a browser with Google Maps.
- **The association is weak and negative.** Pearson r = −0.10 and rank correlation −0.21. Taking
  the log to tame the screen recordings (r = −0.13) changes nothing under cross-validation.
- **It is not duration in disguise.** Its variance inflation factor is 1.1, so unlike word count
  its weight can be read on its own. That weight is −0.02 in-sample and −0.10 in the shipped
  model, both under the 1.0 threshold `inference.py` treats as a relationship worth advice. So
  the app reports text density as having "little to no measurable relationship" with engagement.
- **As a predictor it adds nothing measurable here.** One lecturer's slides vary too little for
  144 videos to show an effect. The feature is still worth keeping for a pooled, multi-lecturer
  dataset, where slide styles differ far more.

### Speech ratio and pauses

Both are measured from the sound, not the transcript: Whisper's segments run straight across
pauses, so they show how much of the video Whisper skipped rather than how much was speech. The
audio stats scan uses a Silero VAD pass that ends speech at a 250 ms silence, the usual cut-off
for a pause in speech research.

| | Min | Q1 | Median | Q3 | Max | ≥ 0.99 | r with APV |
|---|---|---|---|---|---|---|---|
| Speech ratio | 0.778 | 0.963 | 0.982 | 0.987 | 0.996 | 19 of 144 | +0.17 |
| Mean pause (s) | 0.24 | 0.29 | 0.32 | 0.36 | 0.99 | — | −0.30 |

- **Longer pauses go with less watching.** Mean pause length has the strongest correlation with
  APV of any speech feature (r = −0.30, rank correlation −0.22), stronger than speech pace
  variation (−0.21). Pauses per minute is weaker (r = −0.09) and is not a model feature.
- **In the model the two partly overlap.** More speech means fewer and shorter pauses, so with
  both in, speech ratio's weight turns slightly negative (−0.92 in-sample) despite its positive
  correlation. Their variance inflation factors are 3.5 and 3.8: related, but each still readable.
- **One video is left out of the model.** `yytmPfR8Hr8` (Thermoforming, 1.6 min) has music under
  the narration the whole way through, so the VAD finds one unbroken stretch of speech and there is
  no pause to average. The model trains on the other 143. Every comparison that does not use mean
  pause still covers all 144.

## Caveats

- **The target is not independent.** This project's target was rebuilt from upstream's APV, so the
  two target columns agree by construction. The raw Studio data confirms the values are correct.
  It cannot show that the two pipelines would reach them independently.
- **The dataset is narrow.** It is 144 videos from one lecturer, two courses and one channel style,
  and APV is concentrated between 65% and 75%. Any conclusion here is about this dataset.
- **Scene features aren't comparable across the projects.** Results that depend on scene features
  can't be carried from one project's detector to the other's.
- **Speech ratio and pauses were tuned once, by this project only.** The 250 ms pause cut-off
  and 30 ms padding were not varied, and the VAD was not checked against hand-marked pauses.
- **Text density was measured once, by this project only.** Upstream has nothing to compare it
  against, and the OCR itself was not checked against a hand count beyond spot checks of a few
  frames.
- **Upstream's features are its committed data, not re-extracted here.** Its extractor,
  `scripts/extract_characteristics.py`, passes threshold 30 to both scene functions. The committed
  scene change rate equals scene count ÷ duration for every video, allowing for duration being
  rounded to 2 dp.

## Reproducing

From `server/`, with the training requirements installed:

```sh
python -m model_training.compare_upstream path/to/open-insights-export-<timestamp>
```

The export must carry screen text (`text_stats`) and audio stats (`audio_stats`), which an export
made after a Scan's "Extract Screen Text" and "Extract Audio Stats" does. The numbers here are
from `open-insights-export-2026-09-17T10_51_24.250Z-text-audio`.

This prints every table above and writes them to `server/build/comparison/`, which is gitignored:

- `report.md` and the tables as CSV
- `joined.csv`: the per-video values from both projects side by side
- Figures:
  - `feature_agreement.png`
  - `distributions.png` (Figure 4)
  - `correlations.png` (Figure 5)
  - `loess.png` (Figure 6)
  - `paper_protocol_weights.png` (Stage 5)

The export must contain these same 144 videos. The script names any video that only one side has
and stops.

`server/model_training/test_compare_upstream.py` checks two things: that the paper's model still
reproduces from the committed data, and that the Studio exports still hold the target exactly.
