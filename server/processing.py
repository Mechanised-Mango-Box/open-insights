import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import whisper

from db import complete_scene_stats, complete_transcript, fail_scene_stats, fail_transcript
from models import SceneStats, Transcript, TranscriptSegment
from utils import Failure, Result, Success

# Ported from video_analysis/whisper_functions.py. Loaded eagerly at import time,
# same as the original — every server start pays the model load cost upfront.
_whisper_model = whisper.load_model("turbo")

# _whisper_model is a single shared instance - concurrent transcribe() calls from
# different threads corrupt its internal state (observed in practice as spurious
# "cannot reshape tensor of 0 elements" failures), so all transcription is
# serialized through this lock. scene_stats jobs don't touch _whisper_model (each
# uses its own cv2.VideoCapture) and are unaffected, so they still run concurrently
# with a transcript job.
_whisper_lock = threading.Lock()

# Runs transcript/scene_stats generation off the request thread so a GET can
# return its "processing" status immediately instead of blocking for the
# duration of the calculation. Whisper and OpenCV do their heavy work in
# native/PyTorch code that releases the GIL, so a thread pool (rather than
# multiprocessing) is sufficient to get real concurrency here.
_executor = ThreadPoolExecutor(max_workers=2)


def calculate_transcript(file_path: Path) -> Transcript:
    with _whisper_lock:
        result = _whisper_model.transcribe(str(file_path))
    segments = [
        TranscriptSegment(start=segment["start"], end=segment["end"], text=segment["text"])
        for segment in result["segments"]
    ]
    # Counted off the joined segments rather than Whisper's own flattened result["text"], so
    # these match what the client gets when it recomputes stats from the segments it holds
    # (transcriptFullText joins the same way) - otherwise the two would drift apart.
    text = " ".join(segment.text for segment in segments)
    return Transcript(
        count_chars=len(text),
        count_words=len(text.split()),
        segments=segments,
    )


def _run_transcript_job(file_hash: str, file_path: Path) -> None:
    try:
        transcript = calculate_transcript(file_path)
    except Exception as e:
        fail_transcript(file_hash, str(e))
        return
    complete_transcript(file_hash, transcript)


def submit_transcript_job(file_hash: str, file_path: Path) -> None:
    _executor.submit(_run_transcript_job, file_hash, file_path)


# Ported from gui/feature_extraction.py (video_duration_mins, count_scene_transitions),
# orchestrated the same way gui/tab_scenes_stats.py does. NOT based on
# video_analysis/open_cv_functions.py, which opens its VideoCapture at module scope
# against an undefined variable and crashes on import.
def video_duration_mins(video_capture: cv2.VideoCapture) -> Result[float, str]:
    if not video_capture.isOpened():
        return Failure(f"Failed to open video file: {video_capture}")

    fps = video_capture.get(cv2.CAP_PROP_FPS)
    total_frames = video_capture.get(cv2.CAP_PROP_FRAME_COUNT)

    duration = (total_frames / fps) / 60  # in mins
    return Success(duration)


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


def calculate_scene_stats(file_path: Path) -> SceneStats:
    video_capture = cv2.VideoCapture(str(file_path))
    try:
        match (video_duration_mins(video_capture), count_scene_transitions(video_capture)):
            case (Success(duration_mins), Success(transition_count)):
                return SceneStats(
                    duration_secs=duration_mins * 60,
                    scenes=float(transition_count),
                )
            case errs:
                raise RuntimeError(f"Scene stats calculation failed: {errs}")
    finally:
        video_capture.release()


def _run_scene_stats_job(file_hash: str, file_path: Path) -> None:
    try:
        scene_stats = calculate_scene_stats(file_path)
    except Exception as e:
        fail_scene_stats(file_hash, str(e))
        return
    complete_scene_stats(file_hash, scene_stats)


def submit_scene_stats_job(file_hash: str, file_path: Path) -> None:
    _executor.submit(_run_scene_stats_job, file_hash, file_path)
