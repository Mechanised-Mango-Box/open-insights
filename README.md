# Open Insights

A video analysis tool for audio/video features and audience engagement.

## Quickstart

1. Go to https://open-insights-ccx.pages.dev/
2. Download the server and run it locally.

### Export

Exporting your results gives you `open-insights-export-<timestamp>.zip`, laid out
like this:

```
manifest.json
transcript/
  |-- abcd1234.srt
  `-- hjkl0987.srt
video_files/
  |-- abcd1234.mp4
  `-- hjkl0987.mkv
audience_retention/
  |-- abcd1234.json
  `-- hjkl0987.json
```

- Simple data will be stored within the `manifest.json`
- Complex/large data will be given a sub-directory, `manifest.json` will link to it instead

An export is also what the engagement models are trained on - see [Engagement models](#engagement-models).

### Import

The output `.zip` can be similarly imported back into the app.

### Browser compute (experimental)

Run certain jobs on the browser instead

- Transcription needs WebGPU
- Scene stats read MP4 and MOV only
- Screen text (OCR) and audio stats always run on the server

> It is unstable and may be slow. Off by default

## For Developers/Hosts

### Client

A static site. Manages your local data and sends calculation work to the configured server.

```sh
cd ./client
npm install
npm start
```

### Server

A REST API server. Runs video analysis and engagement model inference, and caches results by video hash.

Fetch the transcription model once before the first run, and again whenever `WHISPER_MODEL` changes:

```sh
cd ./server
pip install -r requirements.txt
pip install --no-deps -r requirements-nodeps.txt
python scripts/fetch_whisper_model.py
python main.py
```

The second install is RapidOCR, which reads on-screen text. It goes in without its
declared dependencies because one of them is the full `opencv-python`, which would
replace the headless OpenCV the server uses; the rest are pinned in `requirements.txt`.
Its OCR models ship inside the package, so there is nothing to fetch for it.

Audio stats measure two of Mayer's multimedia principles. Coherence is the share of the
video that is sound other than speech (music, effects) no more than 20 dB quieter than the
speaker. Voice is how much the speaker's pitch varies, in semitones. Speech is found by the
Silero VAD model that ships with faster-whisper, and pitch by Praat (`praat-parselmouth`),
so there is nothing to fetch for these either.

Uploads must be `.mp4`, `.mov`, `.mkv`, `.webm` or `.avi`, and the server checks that the
file really is a video in that container before storing it; anything else is refused with
a 415 that says why. AV1 videos work too: the OpenCV wheels decode AV1 only with hardware
support, so where they cannot, scene stats and screen text decode through PyAV instead.

#### Engagement models

The Recommend step asks one of the server's engagement models about a single video. Each
model is a random forest that predicts average percentage viewed, plus a linear regression
on standardised features that explains which way each feature leans. Four are committed
in the repository's top-level `models/`, trained on different feature sets:

| Model | Features | Scans it needs | Ships in the server |
|---|---|---|---|
| `full` (default) | all eight | scene, transcript, screen text, audio | yes |
| `fast` | all but on-screen text | scene, transcript, audio | yes |
| `video` | duration, scene change rate, text density | scene, screen text | no - add it |
| `audio` | duration, transcript and audio features | transcript, audio | no - add it |

`BUILTIN_MODELS` (default `full,fast`) names the ones a server serves without being
added; `ENGAGEMENT_MODEL_DEFAULT` (default `full`) must be one of them. The portable build
packs only those. The Docker image copies all of `models/` in through a second build
context (`additional_contexts` in `docker-compose.yml`, which needs Compose 2.17+; a bare
`docker build` needs `--build-context models=../models`), and `BUILTIN_MODELS` decides
what is served.

`fast` leaves out screen text because OCR is the slowest scan. On 1080p lecture video, on a
16-core CPU, the scans took about 7 s per minute of video for OCR, 4.3 s for scene stats,
1.3 s for transcription and 0.3 s for audio stats.

Each model is a directory with `model.joblib` (the pickled models) and `model.json` (its
**model card**). The card records the provider, notes, when it was trained, the
hyperparameters, the feature definitions, the training export and split, held-out RMSE and
R², feature importances and the package versions. The server lists the cards at
`GET /api/models` without unpickling anything, and the Recommend step shows the selected
one on its Model tab. `?model=<id>` on the recommendation request picks a model;
the response names the model that answered.

**Adding a model.** Open the server's own page (`http://localhost:5000/`) in a browser on
the same machine. Under *Engagement models* you can:

- download a published model in one click (checked against its pinned SHA-256),
- download a package from any `https://` URL, with an optional SHA-256, or
- upload a package.

A **model package** is a `.zip` holding exactly `model.json` and `model.joblib`. The server
reads the card, checks that this server can compute its features and has the same
scikit-learn version, loads the model once to make sure it works, and only then keeps it,
under `MODELS_DIR` (default `data/models` beside the database). Added models can be deleted
from the same page; built-in ones cannot.

> A model file is a pickle, and loading one runs whatever code its author put in it. Only
> add models from providers you trust. Because of that, the page's forms answer only a
> browser on the server's own machine: the connection must come from loopback, with a
> loopback `Host`, no forwarding header, a same-origin `Origin` and the page's per-process
> token. `MODEL_MANAGEMENT=0` turns adding models off entirely, and `docker-compose.yml`
> sets it, so a public server answers with its built-in models only. `MODEL_MAX_BYTES`
> caps a package (default 200 MB).

**Sharing a model.** Package a committed model without retraining, and publish the zip
(on a release, say) with the SHA-256 it prints:

```sh
cd ./server
python scripts/package_model.py ../models/video    # writes dist/models/video.zip
```

**Training a model.** The models are committed under `models/<id>/`, and the Docker
image and portable build ship them as-is. Regenerate them, and commit the result,
whenever there is a better export to learn from, the scikit-learn, numpy, pandas or
joblib pins in `requirements.txt` change (a scikit-learn pickle does not load under
another version) or anything in `model_training/` that shapes the models changes:

```sh
cd ./server
for set in full fast video audio; do
  python scripts/train_engagement_model.py path/to/export.zip --feature-set $set
done
```

Each lands in `models/<feature set>/`. `--id`, `--name`, `--version`, `--description`,
`--provider`, `--provider-url` and `--notes` fill in the card, and `--package FILE.zip`
also writes a package.

It trains on a client [export](#export) - the zip, or the zip unpacked into a folder.
Only `manifest.json` is read, so exporting without video files is enough. A record
becomes a training row when Scan has produced the results its feature set comes from and
a YouTube content report supplied its average view duration; the script prints how many
records it kept and why it skipped the rest. The features are computed exactly as the
client computes them, and the target is average view duration ÷ duration × 100. Duration
comes from scene stats, or from audio stats for a feature set with no scene feature (see
`model_training/data_preparation.py`). There is no built-in dataset to fall back on: the
script refuses to run without an export.

Training is seeded, so the same export, code and pins produce the same model. The
export itself is not committed, so the card records what it learned from:

```sh
python -c "import json; print(json.load(open('../models/full/model.json'))['training'])"
```

#### How results are calculated

Every scan result carries the settings it was made with, and `/status` reports each
kind's settings and a description of its method (`*_SETTINGS` and `*_METHOD` in
`server/config.py`). The Scan step shows them under "How Scan calculates its data", the
Analysis step explains its techniques and constants and how many records it left out and
why, and the Recommend step shows the workings behind each result. An export records
each result's producer and settings in `manifest.json` (`scan_provenance`), and an
analysis export includes a `methods.json`.

The exploration scripts in `model_training/` take an export the same way (install
`requirements-training.txt` first for their plots), e.g.
`python -m model_training.data_analysis <export>` for histograms, correlations and
LOESS curves, or `python -m model_training.train <export>` for a dry run that saves
nothing. `python -m model_training.compare_upstream <export>` sets an export of the
EduVideo Insights lecture set beside that project's paper and data; the results are
written up in `data/sample/edu-video-insights/COMPARISON.md`.

## Build and deploy your own

### A portable executable

A single file with the transcription weights inside. No Python, no pip, no network.

```sh
cd ./server
python scripts/build_portable.py    # --install fetches what is missing
```
Leaves `dist/open-insights-server-<platform>-x86_64`. Run it anywhere: it keeps
its database and uploads in a `data` directory beside itself, and prints how to
point a client at it. Set `SHOW_INSTRUCTIONS=0` to silence that.

- Build it on the platform you will run it on. PyInstaller cannot cross-compile,
  and a Linux build will not run on an older distribution than the one that built it.
- Binds `127.0.0.1` only, unlike `python main.py`. Set `SERVER_HOST=0.0.0.0` to expose it.
- Unpacks itself on every launch, so startup takes a few seconds.

### A public server

Public-facing features are off by default and enabled through the environment.
`docker-compose.yml` sets them, and runs Caddy alongside for TLS certificates.

```sh
cp .env.example .env
docker compose up -d --build
```

Required in `.env`:

- `SITE_ADDRESS` - a real hostname, not a bare IP. A free DuckDNS subdomain works.
- `ALLOWED_ORIGINS` - where your client is served from. Compose will not start without it.
- `DATA_DIR` - must exist and be writable by uid 1000 before the first `up`.
  See `.env.example` for the `chown`.
- `PUBLIC_API_KEY` and `PRIVATE_API_KEY`.

#### API keys

Sent as `X-API-Key`.

| | `PUBLIC_API_KEY` | `PRIVATE_API_KEY` |
|---|---|---|
| Who has it | anyone - it ships in the client bundle | you |
| Rate limits | yes | exempt |
| Upload size | `PUBLIC_MAX_UPLOAD_BYTES` | `MAX_UPLOAD_BYTES` |
| Queue depth | refused past `PUBLIC_MAX_QUEUE_DEPTH` | never refused |

> The public key is not a secret. It ships inside a public static site. It exists to
> slow down scripted abuse and to give you something to rotate. The size and queue
> caps are what limit your costs.

#### Recommended settings

Set in `docker-compose.yml`.

- `BACKFILL_ENABLED=0` - stops the idle sweep transcribing uploads nobody asked for.
  Dead jobs are still reclaimed on the request path.
- `UPLOAD_DIR_MAX_BYTES` - deletes the oldest videos past this size. Transcripts and
  scene stats are kept, so a deleted video costs one re-upload.
- `MAX_BODY_SIZE` - Caddy's own cap. Keep it at or above `PUBLIC_MAX_UPLOAD_BYTES`
  or uploads fail at the proxy.
