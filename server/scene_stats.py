"""Scene stats: a video's duration, and how many times its picture changes.

Ported from gui/feature_extraction.py (video_duration_mins, count_scene_transitions),
orchestrated the same way gui/tab_scenes_stats.py does. NOT based on
video_analysis/open_cv_functions.py, which opens its VideoCapture at module scope
against an undefined variable and crashes on import.

Kept apart from processing.py, which loads the Whisper model when imported, so
this can be exercised without one.
"""
from pathlib import Path
from typing import Iterable, Iterator

import cv2
import numpy as np

from config import SCENE_THRESHOLD
from models import SceneStats
from utils import Failure, Result, Success
from video_files import codec_name, pyav_video


def video_duration_mins(video_capture: cv2.VideoCapture) -> Result[float, str]:
    if not video_capture.isOpened():
        return Failure(f"Failed to open video file: {video_capture}")

    fps = video_capture.get(cv2.CAP_PROP_FPS)
    total_frames = video_capture.get(cv2.CAP_PROP_FRAME_COUNT)

    # isOpened() does not cover this: OpenCV opens a container happily and still
    # reports fps 0 for a variable-frame-rate file, and frame count 0 or -1 when
    # the container carries no index. Dividing anyway raised ZeroDivisionError,
    # which reached the user as the job error "float division by zero" - a
    # server bug by appearance, when the real answer is that this file's
    # metadata cannot be read.
    if fps <= 0 or total_frames <= 0:
        return Failure(f"Unreadable video metadata (fps={fps}, frames={total_frames})")

    duration = (total_frames / fps) / 60  # in mins
    return Success(duration)


def count_scene_transitions(
    frames: Iterable[np.ndarray], threshold: float = SCENE_THRESHOLD
) -> tuple[int, int]:
    """How many consecutive pairs of BGR frames differ by more than `threshold`
    (the mean absolute difference of their grayscale, out of 255), and how many
    frames there were."""
    transition_count = 0
    frame_count = 0
    previous_frame = None

    for frame in frames:
        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if previous_frame is not None:
            difference = cv2.absdiff(previous_frame, gray_frame)
            mean_difference = difference.mean()
            if mean_difference > threshold:
                transition_count += 1

        previous_frame = gray_frame
        frame_count += 1

    return transition_count, frame_count


def _opencv_frames(video_capture: cv2.VideoCapture) -> Iterator[np.ndarray]:
    while True:
        success, frame = video_capture.read()
        if not success:
            return
        yield frame


def calculate_scene_stats(file_path: Path) -> SceneStats:
    video_capture = cv2.VideoCapture(str(file_path))
    try:
        duration = video_duration_mins(video_capture)
        # Threshold passed explicitly rather than left to the default, so the
        # value that shaped this result is the same one SCENE_STATS_PRODUCER
        # records - otherwise a changed config would not invalidate the cache.
        transitions, frames = count_scene_transitions(
            _opencv_frames(video_capture), SCENE_THRESHOLD
        )
    finally:
        video_capture.release()

    # OpenCV decoded nothing: a file it could not open, or one it opened in a
    # codec its build cannot decode - AV1, on a machine without hardware for it.
    # That used to be returned as 0 scenes, which once cached cannot be told from
    # a video that really never cuts. PyAV decodes the same frames (on H.264 and
    # VP9 the two count every frame and every transition identically).
    if frames == 0:
        try:
            with pyav_video(file_path) as (duration_secs, decoded):
                transitions, frames = count_scene_transitions(
                    (frame.to_ndarray(format="bgr24") for frame in decoded), SCENE_THRESHOLD
                )
        except Exception as e:  # PyAV's own errors, named rather than swallowed
            raise RuntimeError(
                f"No frames could be read from the video (codec {codec_name(file_path)}): {e}"
            ) from e
        # OpenCV's frames / fps where it could read them, as for every other
        # video; the stream's own duration only where it could not.
        if isinstance(duration, Failure) and duration_secs is not None:
            duration = Success(duration_secs / 60)

    if frames == 0:
        raise RuntimeError(
            f"No frames could be read from the video (codec {codec_name(file_path)})."
        )

    match duration:
        case Success(duration_mins):
            return SceneStats(duration_secs=duration_mins * 60, scenes=float(transitions))
        case Failure(error):
            raise RuntimeError(f"Scene stats calculation failed: {error}")
