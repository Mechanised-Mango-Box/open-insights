# Open Insights

A video analysis tool for audio/video features and audience engagement.

## Architecture
### Client
A static site which renders and manages local data,  and communicates with the nominated server for its calculations.

### Server
A REST API server which performs the calculations for video analysis as well as model training and inference. It caches results based on the video's hash.

| HTTP Method | Route | Description | Options | Response |
| --- | --- |  --- | --- | --- |
| POST | `/api/videos` | Submit a video file | `multipart/form-data` field `file` | `201`/`200` `{file_hash, filename}` (Location header set); `400` if no file or an invalid extension |
| GET | `/api/videos/<file_hash>` | Fetch metadata for a previously uploaded video | none | `200` `{file_hash, file_ext}`; `404` if not uploaded |
| GET | `/api/videos/<file_hash>/transcript` | Fetch the video's transcript. Generation (via Whisper) runs asynchronously, triggered by the first request — poll the same route until `status` settles | `peek=true` — report status without ever starting generation<br>`retry=true` — reclaim a `failed` job and retry it | `200` `{status: "not_started" \| "processing" \| "complete" \| "failed"}` (`complete` adds `text`, `count_chars`, `count_words`; `failed` adds `error`); `404` if the video hasn't been uploaded |
| GET | `/api/videos/<file_hash>/scene_stats` | Fetch the video's scene statistics. Generation (via OpenCV) runs asynchronously, triggered by the first request — poll the same route until `status` settles | `peek=true` — report status without ever starting generation<br>`retry=true` — reclaim a `failed` job and retry it | `200` `{status: "not_started" \| "processing" \| "complete" \| "failed"}` (`complete` adds `duration_secs`, `scenes`; `failed` adds `error`); `404` if the video hasn't been uploaded |
| POST | `/api/analysis` | Run statistical analysis over a submitted array of feature rows | JSON body: array of ≥2 rows, each with `duration_mins`, `wpm`, `scene_change_rate`, `word_count`, `average_percentage_viewed` | `200` `{histograms, correlations, loess}`; `400` if the body isn't a valid feature-row array |
