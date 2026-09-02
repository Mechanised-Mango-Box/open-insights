# Open Insights

A video analysis tool for audio/video features and audience engagement.

## Architecture
### Client
A static site which renders and manages local data,  and communicates with the nominated server for its calculations.

### Server
A REST API server which performs the calculations for video analysis as well as model training and inference. It caches results based on the video's hash.

## Export
This tool will export the results that you have in the following format:
```
output/
  |-- manifest.json
  |-- transcript/
  |     |-- abcd1234.txt
  |     `-- hjkl0987.txt
  |
  |-- video_files/
  |     |-- abcd1234.mp4
  |     `-- hjkl0987.mkv
  |
(And so on...)
```

- Simple data will be stored within the `manifest.json`
- Complex/large data will be given a sub-directory, `manifest.json` will link to it instead