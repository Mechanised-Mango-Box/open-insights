# Open Insights

A video analysis tool for audio/video features and audience engagement.

## Quickstart

Go to https://mechanised-mango-box.github.io/open-insights/

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

### Server

A REST API server which performs the calculations for video analysis as well as model training and inference. It caches results based on the video's hash.

The server never downloads its own transcription model - fetch it once before first run (and again whenever `WHISPER_MODEL` changes):

```sh
cd ./server
py scripts/fetch_whisper_model.py
py main.py
```