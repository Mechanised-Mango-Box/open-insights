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

### Import

The output `.zip` can be similarly imported back into the app.

### Browser compute (experimental)

Run certain jobs on the browser instead

- Transcription needs WebGPU
- Scene stats read MP4 and MOV only

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

A REST API server. Runs video analysis, model training and inference, and caches results by video hash.

Fetch the transcription model once before the first run, and again whenever `WHISPER_MODEL` changes:

```sh
cd ./server
pip install -r requirements.txt
python scripts/fetch_whisper_model.py
python main.py
```

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
