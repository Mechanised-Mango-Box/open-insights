# Open Insights

A video analysis tool for audio/video features and audience engagement.

## Architecture
### Client
A static site which renders and manages local data,  and communicates with the nominated server for its calculations.

### Server
A REST API server which performs the calculations for video analysis as well as model training and inference. It caches results based on the video's hash.

| HTTP Method | Route | Note |
| --- | --- |  --- |
| POST | `/api/videos` | Submit a video file |
| GET | `/api/videos/<file_hash>` | Fetch metadata for a previously uploaded video |
| GET | `/api/videos/<file_hash>/transcript` | Fetch the video's transcript. Generation (via Whisper) runs asynchronously and is triggered by the first request; the response carries a `status` of `processing`, `complete`, or `failed` — poll the same route until it settles |
| GET | `/api/videos/<file_hash>/scene_stats` | Fetch the video's scene statistics. Generation (via OpenCV) runs asynchronously and is triggered by the first request; the response carries a `status` of `processing`, `complete`, or `failed` — poll the same route until it settles |
| POST | `/api/analysis` | Run statistical analysis over a submitted array of feature rows |
