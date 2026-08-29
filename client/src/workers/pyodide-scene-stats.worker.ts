/// <reference lib="webworker" />

import { PyodideInterface } from 'pyodide';
const VERSION = '314.0.6';
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;

let pyodidePromise: any;

async function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = import(`${INDEX_URL}pyodide.mjs`).then(({ loadPyodide }) =>
      loadPyodide({
        indexURL: INDEX_URL,
      }),
    );
  }

  return pyodidePromise;
}

const getVideoHandle = async (name: string) => {
  const rootDir = await navigator.storage.getDirectory();
  const videosDir = await rootDir.getDirectoryHandle('videos');
  const fileHandle = await videosDir.getFileHandle(name);

  return fileHandle;
};

onmessage = async (msg: MessageEvent<string[]>) => {
  const names: string[] = msg.data;
  console.log('Worker: Message received from main script');
  const fileHandles = await Promise.all(names.map((name) => getVideoHandle(name)));

  console.log('Worker: Loading pyodide');
  const pyodide = await getPyodide();

  fileHandles.forEach((fileHandle) => {
    calcSceneStats(pyodide, fileHandle);
  });
  postMessage(names + '!');
};

const calcSceneStats = async (pyodide: PyodideInterface, fileHandle: FileSystemFileHandle) => {
  try {
    // 2. READ from OPFS to bring it into Python's reach
    // We get the file object from the handle
    const opfsFile = await fileHandle.getFile();
    const arrayBuffer = await opfsFile.arrayBuffer();
    // 3. Write the bytes into Pyodide's Virtual File System (MEMFS)
    // This makes the file available to Python's open()
    pyodide.FS.writeFile(fileHandle.name, new Uint8Array(arrayBuffer));
    console.log(`File ${fileHandle.name} moved to Python memory. Reading...\n`);
    // 4. Tell Python to open the file natively
    await pyodide.loadPackage('opencv-python');
    const pythonCode = `
      import cv2
      # next function we need is to get the video duration
      # to get this we need to use a tool called open cv which is a computer vision Tool used to analsye images, video analysis, and more.
      def video_duration_mins(video_capture: cv2.VideoCapture):
          # check if the file has opened
          if not video_capture.isOpened():
              return f"Failed to open video file: {video_capture}"
          # get the frames per second property
          fps = video_capture.get(cv2.CAP_PROP_FPS)
          # get totatl frames in video
          total_frames = video_capture.get(cv2.CAP_PROP_FRAME_COUNT)
          duration = (total_frames / fps) / 60  # in mins
          return duration
      # Open CV only lets you or gives you the tools to analyse frames/images, we have to write our own algorithm to define what a change in scene is.
      # VideoCapture.read() returns two values which are, success and frame, a boolean and an array of pixel data.
      def count_scene_transitions(
          video_capture: cv2.VideoCapture, threshold: float = 30.0
      ):
          if not video_capture.isOpened():
              return f"Failed to open video file: {video_capture}"
          transition_count = 0
          previous_frame = None
          while True:
              success, frame = video_capture.read()
              if not success:
                  break
              gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
              if previous_frame is not None:
                  difference = cv2.absdiff(previous_frame, gray_frame)
                  mean_difference = difference.mean()
                  if mean_difference > threshold:
                      transition_count += 1
              previous_frame = gray_frame
          return transition_count
      # Now we can use standard Python open() because the file is in MEMFS
      filename = "${fileHandle.name}"
      try:
      #     with open(filename, "r") as f:
      #         content = f.read()
      #         print(f"--- Content of {filename} ---")
      #         print(content)
      #         print("--- End of File ---")
      # else:
        print(f"Loading: {filename}")
        video_capture = cv2.VideoCapture(filename)
        cst = count_scene_transitions(video_capture)
        dur = count_scene_transitions(video_capture)
        print(f"scenes: {cst}")
        print(f"dur: {dur}")
        print("done")
        [cst, dur]
      except Exception as e:
          print(f"Error reading file: {e}")
                      `;
    pyodide.setStdout({
      batched: (str) => {
        console.log('PY: ' + str);
      },
    });
    console.log('RES: ' + (await pyodide.runPythonAsync(pythonCode)));
    return -1;
  } catch (err) {
    console.log('\nError: ' + err);
    return -1;
  }
};

// console.log(`Starting WebWorker for ${names.length} items.`);
// if (window.Worker) {
//   const w = new Worker(new URL('../workers/pyodide-scene-stats.ts', import.meta.url), {
//     type: 'module',
//   });
//   w.postMessage(names);
//   w.onmessage = (ev) => {
//     console.log('Message received from worker' + ev.data);
//   };
// } else {
//   console.error('[ WebWorkers ] No supported.');
// }
//     const pyodide = await window.pyodideReady;
//     const fileHandle = await this.opfsService.getVideoHandle(name);
//     try {
//       // 2. READ from OPFS to bring it into Python's reach
//       // We get the file object from the handle
//       const opfsFile = await fileHandle.getFile();
//       const arrayBuffer = await opfsFile.arrayBuffer();
//       // 3. Write the bytes into Pyodide's Virtual File System (MEMFS)
//       // This makes the file available to Python's open()
//       pyodide.FS.writeFile(name, new Uint8Array(arrayBuffer));
//       console.log(`File ${name} moved to Python memory. Reading...\n`);
//       // 4. Tell Python to open the file natively
//       await pyodide.loadPackage('opencv-python');
//       const pythonCode = `
// import cv2
// # next function we need is to get the video duration
// # to get this we need to use a tool called open cv which is a computer vision Tool used to analsye images, video analysis, and more.
// def video_duration_mins(video_capture: cv2.VideoCapture):
//     # check if the file has opened
//     if not video_capture.isOpened():
//         return f"Failed to open video file: {video_capture}"
//     # get the frames per second property
//     fps = video_capture.get(cv2.CAP_PROP_FPS)
//     # get totatl frames in video
//     total_frames = video_capture.get(cv2.CAP_PROP_FRAME_COUNT)
//     duration = (total_frames / fps) / 60  # in mins
//     return duration
// # Open CV only lets you or gives you the tools to analyse frames/images, we have to write our own algorithm to define what a change in scene is.
// # VideoCapture.read() returns two values which are, success and frame, a boolean and an array of pixel data.
// def count_scene_transitions(
//     video_capture: cv2.VideoCapture, threshold: float = 30.0
// ):
//     if not video_capture.isOpened():
//         return f"Failed to open video file: {video_capture}"
//     transition_count = 0
//     previous_frame = None
//     while True:
//         success, frame = video_capture.read()
//         if not success:
//             break
//         gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
//         if previous_frame is not None:
//             difference = cv2.absdiff(previous_frame, gray_frame)
//             mean_difference = difference.mean()
//             if mean_difference > threshold:
//                 transition_count += 1
//         previous_frame = gray_frame
//     return transition_count
// # Now we can use standard Python open() because the file is in MEMFS
// filename = "${name}"
// try:
// #     with open(filename, "r") as f:
// #         content = f.read()
// #         print(f"--- Content of {filename} ---")
// #         print(content)
// #         print("--- End of File ---")
// # else:
//     print(f"Loading: {filename}")
//     video_capture = cv2.VideoCapture(filename)
//     print(f"scenes: {count_scene_transitions(video_capture)}")
//     print(f"dur: {video_duration_mins(video_capture)}")
//     print("done")
// except Exception as e:
//     print(f"Error reading file: {e}")
//                 `;
//       pyodide.setStdout({
//         batched: (str) => {
//           console.log(str);
//         },
//       });
//       await pyodide.runPythonAsync(pythonCode);
//       return -1;
//     } catch (err) {
//       console.log('\nError: ' + err);
//       return -1;
//     }
