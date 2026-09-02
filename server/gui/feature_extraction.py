# pyrefly: ignore [missing-import]
import cv2

# pyrefly: ignore [missing-import]
from utils import *


# next function we need is to get the video duration
# to get this we need to use a tool called open cv which is a computer vision Tool used to analsye images, video analysis, and more.
def video_duration_mins(video_capture: cv2.VideoCapture) -> Result[float, str]:
    # check if the file has opened
    if not video_capture.isOpened():
        return Failure(f"Failed to open video file: {video_capture}")

    # get the frames per second property
    fps = video_capture.get(cv2.CAP_PROP_FPS)

    # get totatl frames in video
    total_frames = video_capture.get(cv2.CAP_PROP_FRAME_COUNT)

    duration = (total_frames / fps) / 60  # in mins
    return Success(duration)


# Open CV only lets you or gives you the tools to analyse frames/images, we have to write our own algorithm to define what a change in scene is.
# VideoCapture.read() returns two values which are, success and frame, a boolean and an array of pixel data.
def count_scene_transitions(
    video_capture: cv2.VideoCapture, threshold: float = 30.0
) -> Result[int, str]:
    if not video_capture.isOpened():
        return Failure(f"Failed to open video file: {video_capture}")

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

    return Success(transition_count)
