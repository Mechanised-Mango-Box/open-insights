"""On-screen text: how much text a video shows, read by OCR.

One frame is read every OCR_SAMPLE_SECS, at the middle of each interval so a fade
in from black at 0:00 is not what the first sample sees. Each is read by RapidOCR
(PP-OCRv6 small, on onnxruntime), and summarised as:

    words     tokens with at least two letters or digits, from lines read with
              confidence >= OCR_MIN_SCORE - which drops the single characters and
              half-read logos a talking-head shot produces, and CJK the
              multilingual model sometimes hallucinates on an English slide
    coverage  the share of the frame the kept lines' boxes cover, capped at 1

and the video by the time-average of both (samples are evenly spaced, so a plain
mean is one): mean_words is the model's text_density feature.

A sample whose small grayscale thumbnail differs from the last frame actually
read by less than OCR_REUSE_THRESHOLD carries that reading instead of being read
again. A slide held for a minute then costs one OCR call, not twelve.

Kept apart from processing.py, which loads the Whisper model when imported, so
this can be exercised without one. RapidOCR itself is imported only when a frame
is first read, for the same reason.
"""
import re
import threading
from dataclasses import dataclass
from math import ceil
from pathlib import Path
from typing import Callable, Iterator, Sequence

import cv2
import numpy as np

from config import OCR_MIN_SCORE, OCR_REUSE_THRESHOLD, OCR_SAMPLE_SECS
from models import TextSample, TextStats
from video_files import codec_name, pyav_video


@dataclass(frozen=True)
class OcrLine:
    """One line of text read from a frame."""

    text: str
    score: float
    # The line's four corner points, (4, 2), in frame pixels.
    box: np.ndarray


# Reads a BGR frame. Injectable so the sampling and summarising can be tested
# without an OCR model.
OcrFn = Callable[[np.ndarray], Sequence[OcrLine]]

# What reuse compares: small enough that sensor noise and compression shimmer
# average out, large enough that a changed bullet point still shows.
_THUMB_SIZE = (160, 90)

_WORD_CHAR = re.compile(r"[A-Za-z0-9]")


def count_words(text: str) -> int:
    return sum(1 for token in text.split() if len(_WORD_CHAR.findall(token)) >= 2)


# One engine per worker thread. An onnxruntime session is safe to share, but
# RapidOCR's wrapper around it keeps per-call state; a thread-local engine costs
# ~0.2s to build once and removes the question.
_local = threading.local()


def _engine():
    engine = getattr(_local, "engine", None)
    if engine is None:
        import rapidocr
        from rapidocr import RapidOCR

        # The model files the wheel ships, named explicitly. Left to its
        # defaults RapidOCR resolves a model by name and will download one it
        # cannot find, and this server never reaches out to the network on its
        # own (see WhisperModel's local_files_only in processing.py).
        models = Path(rapidocr.__file__).parent / "models"
        engine = RapidOCR(
            params={
                # Slides are upright; the orientation classifier is a third
                # model run on every line for nothing.
                "Global.use_cls": False,
                # Every frame with no text logs a warning otherwise.
                "Global.log_level": "error",
                "Det.model_path": str(models / "PP-OCRv6_det_small.onnx"),
                "Rec.model_path": str(models / "PP-OCRv6_rec_small.onnx"),
            }
        )
        _local.engine = engine
    return engine


def rapidocr_read(frame: np.ndarray) -> list[OcrLine]:
    result = _engine()(frame)
    if result.boxes is None or result.txts is None or result.scores is None:
        return []
    return [
        OcrLine(text=text, score=float(score), box=np.asarray(box, dtype=np.float32))
        for box, text, score in zip(result.boxes, result.txts, result.scores)
    ]


def _summarise(
    lines: Sequence[OcrLine], frame_area: float, min_score: float
) -> tuple[int, float, str]:
    kept = [line for line in lines if line.score >= min_score]
    words = sum(count_words(line.text) for line in kept)
    covered = sum(abs(cv2.contourArea(line.box.astype(np.float32))) for line in kept)
    text = "\n".join(line.text for line in kept)
    return words, min(1.0, covered / frame_area), text


def _thumbnail(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.resize(gray, _THUMB_SIZE, interpolation=cv2.INTER_AREA)


def _sample_times(duration_secs: float, sample_secs: float) -> list[float]:
    count = max(1, ceil(duration_secs / sample_secs))
    return [(k + 0.5) * sample_secs for k in range(count)]


def _opencv_frames(file_path: Path, sample_secs: float) -> Iterator[tuple[float, np.ndarray]]:
    video_capture = cv2.VideoCapture(str(file_path))
    try:
        if not video_capture.isOpened():
            return

        fps = video_capture.get(cv2.CAP_PROP_FPS)
        total_frames = int(video_capture.get(cv2.CAP_PROP_FRAME_COUNT))
        # As in scene_stats.video_duration_mins: an opened container can still
        # report no rate or no frame count (a variable-rate file, say), and
        # dividing by it is not an answer. Yielding nothing hands over to PyAV,
        # which reads timestamps rather than a frame rate.
        if fps <= 0 or total_frames <= 0:
            return

        targets = sorted(
            {
                min(total_frames - 1, int(t * fps))
                for t in _sample_times(total_frames / fps, sample_secs)
            }
        )
        position = 0
        for target in targets:
            # grab() decodes without converting, so skipping ahead this way is
            # sequential and exact - unlike seeking, which lands on whatever the
            # codec's nearest keyframe allows.
            while position < target and video_capture.grab():
                position += 1
            if position < target:
                return  # The container promised more frames than it holds.
            ok, frame = video_capture.read()
            if not ok:
                return
            position += 1
            yield round(target / fps, 3), frame
    finally:
        video_capture.release()


def _pyav_frames(file_path: Path, sample_secs: float) -> Iterator[tuple[float, np.ndarray]]:
    """The same samples, decoded by PyAV - for a codec OpenCV opens and then
    cannot decode (see video_files)."""
    with pyav_video(file_path) as (duration_secs, frames):
        if duration_secs is None:
            return
        targets = _sample_times(duration_secs, sample_secs)
        index = 0
        for frame in frames:
            if frame.time is None or frame.time < targets[index]:
                continue
            yield round(frame.time, 3), frame.to_ndarray(format="bgr24")
            # One frame per sample time, even where a frame straddles several.
            while index < len(targets) and targets[index] <= frame.time:
                index += 1
            if index == len(targets):
                return


def calculate_text_stats(
    file_path: Path,
    ocr: OcrFn | None = None,
    sample_secs: float = OCR_SAMPLE_SECS,
    reuse_threshold: float = OCR_REUSE_THRESHOLD,
    min_score: float = OCR_MIN_SCORE,
) -> TextStats:
    read = ocr or rapidocr_read

    def read_samples(frames: Iterator[tuple[float, np.ndarray]]) -> list[TextSample]:
        samples: list[TextSample] = []
        last_thumb: np.ndarray | None = None
        last_reading: tuple[int, float, str] = (0, 0.0, "")
        for t, frame in frames:
            thumb = _thumbnail(frame)
            reused = (
                last_thumb is not None
                and float(cv2.absdiff(thumb, last_thumb).mean()) < reuse_threshold
            )
            if not reused:
                frame_area = float(frame.shape[0] * frame.shape[1])
                last_reading = _summarise(read(frame), frame_area, min_score)
                last_thumb = thumb
            words, coverage, text = last_reading
            samples.append(
                TextSample(t=t, words=words, coverage=round(coverage, 5), reused=reused, text=text)
            )
        return samples

    # OpenCV first: it is what scene stats decode with, so the two agree on every
    # video both can read. PyAV only when OpenCV produced nothing at all.
    samples = read_samples(_opencv_frames(file_path, sample_secs))
    if not samples:
        try:
            samples = read_samples(_pyav_frames(file_path, sample_secs))
        except Exception as e:  # PyAV's own errors, named rather than swallowed
            raise RuntimeError(
                f"No frames could be read from the video (codec {codec_name(file_path)}): {e}"
            ) from e
    if not samples:
        raise RuntimeError(
            f"No frames could be read from the video (codec {codec_name(file_path)})."
        )

    return TextStats(
        sample_count=len(samples),
        mean_words=sum(s.words for s in samples) / len(samples),
        max_words=max(s.words for s in samples),
        mean_coverage=sum(s.coverage for s in samples) / len(samples),
        text_frames_ratio=sum(1 for s in samples if s.words > 0) / len(samples),
        samples=samples,
    )
