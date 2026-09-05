import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import cv2
from faster_whisper import WhisperModel

from config import (
    SCENE_THRESHOLD,
    UPLOAD_FOLDER,
    WHISPER_COMPUTE_TYPE,
    WHISPER_CPU_THREADS,
    WHISPER_DEVICE,
    WHISPER_MODEL,
    WHISPER_MODEL_DIR,
    WHISPER_VAD,
)
from db import (
    KINDS,
    SCENE_STATS,
    TRANSCRIPT,
    DatasetKind,
    claim,
    fail,
    put_result,
    queued_jobs,
    scene_stats_values,
    transcript_values,
)
from models import SceneStats, Transcript, TranscriptSegment
from utils import Failure, Result, Success

# Loaded eagerly at import time — every server start pays the model load cost
# upfront rather than making the first request wear it.
_whisper_model = WhisperModel(
    WHISPER_MODEL,
    device=WHISPER_DEVICE,
    compute_type=WHISPER_COMPUTE_TYPE,
    cpu_threads=WHISPER_CPU_THREADS,
    download_root=WHISPER_MODEL_DIR,
)

# CTranslate2 is thread-safe, unlike the openai-whisper model this replaced (whose
# shared state corrupted under concurrent transcribe() calls, surfacing as spurious
# "cannot reshape tensor of 0 elements" failures). The lock is kept as deliberate
# admission control: one transcription already saturates the CPU, so overlapping
# two only makes both slower. Lifting it in favour of num_workers > 1 is a
# reasonable follow-up, but it should be measured rather than assumed.
_whisper_lock = threading.Lock()

# Runs transcript/scene_stats generation off the request thread so a GET can
# return its "processing" status immediately instead of blocking for the
# duration of the calculation. CTranslate2 and OpenCV do their heavy work in
# native code that releases the GIL, so a thread pool (rather than
# multiprocessing) is sufficient to get real concurrency here.
_executor = ThreadPoolExecutor(max_workers=2)


def calculate_transcript(file_path: Path) -> Transcript:
    with _whisper_lock:
        # NOT BatchedInferencePipeline: batching is ~1.5x faster but collapses
        # segments from ~4s to ~25s, which guts the timestamps this exists to
        # produce. faster-whisper also refuses to batch without vad_filter, so
        # there is no fine-grained batched option to reach for.
        segment_iter, _info = _whisper_model.transcribe(
            str(file_path), vad_filter=WHISPER_VAD
        )
        # transcribe() returns a generator and the model only actually runs as it
        # is consumed, so this list() has to stay inside the lock — hoisting it
        # out would silently move every transcription outside the serialization.
        segments = [
            TranscriptSegment(start=segment.start, end=segment.end, text=segment.text)
            for segment in segment_iter
        ]
    # Counted off the joined segments rather than any flattened whole-transcript string,
    # so these match what the client gets when it recomputes stats from the segments it
    # holds (transcriptFullText joins the same way) - otherwise the two would drift apart.
    text = " ".join(segment.text for segment in segments)
    return Transcript(
        count_chars=len(text),
        count_words=len(text.split()),
        segments=segments,
    )


def _submit[T](
    kind: DatasetKind,
    file_hash: str,
    file_path: Path,
    calculate: Callable[[Path], T],
    to_values: Callable[[T], dict[str, Any]],
) -> None:
    """The one path from 'a job is queued' to 'a result exists or the job is
    marked failed'. Both dataset kinds run through it, so the lifecycle is
    written once and cannot drift between them.

    claim() is what makes this safe to call more than once for the same hash:
    only the caller whose UPDATE matched a queued row proceeds, so a duplicate
    request never starts a second worker on the same video."""

    def run() -> None:
        if not claim(kind, file_hash):
            return
        try:
            result = calculate(file_path)
        except Exception as e:
            fail(kind, file_hash, str(e))
            return
        put_result(kind, file_hash, to_values(result))

    _executor.submit(run)


def submit_transcript_job(file_hash: str, file_path: Path) -> None:
    _submit(TRANSCRIPT, file_hash, file_path, calculate_transcript, transcript_values)


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
    video_capture: cv2.VideoCapture, threshold: float = SCENE_THRESHOLD
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
        # Threshold passed explicitly rather than left to the default, so the
        # value that shaped this result is the same one SCENE_STATS_PRODUCER
        # records - otherwise a changed config would not invalidate the cache.
        match (
            video_duration_mins(video_capture),
            count_scene_transitions(video_capture, SCENE_THRESHOLD),
        ):
            case (Success(duration_mins), Success(transition_count)):
                return SceneStats(
                    duration_secs=duration_mins * 60,
                    scenes=float(transition_count),
                )
            case errs:
                raise RuntimeError(f"Scene stats calculation failed: {errs}")
    finally:
        video_capture.release()


def submit_scene_stats_job(file_hash: str, file_path: Path) -> None:
    _submit(SCENE_STATS, file_hash, file_path, calculate_scene_stats, scene_stats_values)


# Which submitter runs which kind. Lives here rather than in routes.py so the
# startup resume below and the request path cannot disagree about it.
SUBMIT: dict[str, Callable[[str, Path], None]] = {
    TRANSCRIPT.name: submit_transcript_job,
    SCENE_STATS.name: submit_scene_stats_job,
}


def resume_queued_jobs() -> int:
    """Hands every queued job back to the executor at startup. The executor is
    in-process, so a restart loses its workers while the job rows survive:
    without this, init_db would faithfully requeue interrupted work that then
    sat unattended forever, since GET is read-only and nothing else picks it up.
    Returns how many were resubmitted."""
    rows = queued_jobs()
    for row in rows:
        kind = KINDS.get(row["kind"])
        if kind is None:
            continue
        file_path = Path(UPLOAD_FOLDER) / f"{row['file_hash']}.{row['file_ext']}"
        SUBMIT[kind.name](row["file_hash"], file_path)
    return len(rows)
