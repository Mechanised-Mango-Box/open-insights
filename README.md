# Open Insights

A video analysis tool for audio/video features and audience engagement.

## Quickstart

Go to https://open-insights.pages.dev/

Scanning uses a shared public server, which is rate limited. Everything else -
importing, analysis and export - runs entirely in your browser.

> **Moved from `mechanised-mango-box.github.io`?** Your library lived in that
> site's browser storage and cannot follow you to a new address. Open the old URL,
> Export a zip, then Import it here. Nothing is lost, but nothing moves on its own.

## Functionality

### Export

This tool will export the results that you have in the following format:

```
output/
  |-- manifest.json
  |-- transcript/
  |     |-- abcd1234.srt
  |     `-- hjkl0987.srt
  |
  |-- video_files/
  |     |-- abcd1234.mp4
  |     `-- hjkl0987.mkv
  |
(And so on...)
```

- Simple data will be stored within the `manifest.json`
- Complex/large data will be given a sub-directory, `manifest.json` will link to it instead
- Transcripts are written as SRT so they read as subtitles and import back without loss

### Import

"Import From: Export Zip" on the Import step reads one of the above back in, video files
included. Records already in your library are only ever filled in, never overwritten - so
re-importing a zip is safe, and an older export cannot undo newer work.

## For Developers/Hosts

### Client

A static site which renders and manages local data, and communicates with the nominated server for its calculations.

```sh
cd ./client
ng serve
```

The built site is static and serves from the root. Deployment is Cloudflare
Pages, pointed at this repo: root directory `client`, build command
`npm run build`, output directory `dist/open-insights/browser`, and
`NODE_VERSION=22`. Response headers - caching, and a CSP that is currently
report-only - come from [`client/public/_headers`](client/public/_headers),
which also records why the site is not cross-origin isolated.

### Server

A REST API server which performs the calculations for video analysis as well as model training and inference. It caches results based on the video's hash.

The server never downloads its own transcription model - fetch it once before first run (and again whenever `WHISPER_MODEL` changes):

```sh
cd ./server
py scripts/fetch_whisper_model.py
py main.py
```

That gives you an **open** server: no key, no rate limit, and nothing ever
deleted. That is the right default for something on your own machine, and it is
what every gating setting in `config.py` is switched off to preserve.

#### Running one publicly

Everything needed to put it on the internet is off by default and turned on
through the environment. `docker-compose.yml` sets the lot:

```sh
cp .env.example .env      # fill in the keys, hostname and origin
docker compose up -d --build
```

That brings up the API server plus Caddy, which gets and renews a TLS
certificate on its own - so `SITE_ADDRESS` must be a real hostname (a free
DuckDNS subdomain pointed at the box) rather than a bare IP, which cannot have
one.

Two keys, sent as `X-API-Key`:

| | `PUBLIC_API_KEY` | `PRIVATE_API_KEY` |
|---|---|---|
| Who has it | anyone - it ships in the client bundle | you |
| Rate limits | yes | exempt |
| Upload size | `PUBLIC_MAX_UPLOAD_BYTES` | `MAX_UPLOAD_BYTES` |
| Queue depth | refused past `PUBLIC_MAX_QUEUE_DEPTH` | never refused |

The public key is **not a secret** and nothing here treats it as one - it is
served inside a public static site. What it buys is friction against scripted
abuse and something you can rotate. The caps above are what actually bound cost.

Two more things a public box wants, both set in `docker-compose.yml`:

- `BACKFILL_ENABLED=0`. The idle sweep is the only thing that starts work nobody
  asked for; on a shared server that means transcribing every stranger's upload
  unprompted. Dead jobs are still reclaimed on the request path.
- `UPLOAD_DIR_MAX_BYTES`. Nothing else in the server has ever deleted an upload.
  Past this watermark the oldest videos are removed - but their transcripts and
  scene stats are **kept**, so a reaped video costs one re-upload rather than a
  re-transcription.

Deployment notes, including the Oracle Always Free host and its firewall
gotchas, are in the deployment plan.