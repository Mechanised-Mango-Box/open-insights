"""Tiny synthetic videos for the tests: runs of uniform gray frames, so every
scene change can be worked out by hand."""
import os
from fractions import Fraction
from pathlib import Path

import av
import cv2
import numpy as np

WIDTH, HEIGHT, FPS = 64, 48, 10


def _frames(segments):
    """segments: (seconds, gray level) pairs, as BGR frames."""
    for seconds, level in segments:
        for _ in range(int(seconds * FPS)):
            yield np.full((HEIGHT, WIDTH, 3), level, dtype=np.uint8)


def write_mjpeg(path: Path, segments) -> None:
    """Motion JPEG in AVI, which every OpenCV build writes and reads."""
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), FPS, (WIDTH, HEIGHT))
    for frame in _frames(segments):
        writer.write(frame)
    writer.release()


# Whether this PyAV can make an AV1 file to test with. Its Linux, macOS and
# Windows wheels all carry SVT-AV1, but a PyAV built against a system FFmpeg
# might not.
try:
    av.codec.Codec("libsvtav1", "w")
    HAS_AV1_ENCODER = True
except av.FFmpegError:
    HAS_AV1_ENCODER = False


def write_av1(path: Path, segments) -> None:
    """AV1 in MP4: what YouTube serves many videos as, and what the
    opencv-python wheels open but can only decode in hardware."""
    # SVT-AV1 prints a banner of its settings to stderr on every encode.
    os.environ.setdefault("SVT_LOG", "1")
    with av.open(str(path), "w") as container:
        stream = container.add_stream("libsvtav1", rate=FPS)
        stream.width, stream.height, stream.pix_fmt = WIDTH, HEIGHT, "yuv420p"
        for frame in _frames(segments):
            for packet in stream.encode(av.VideoFrame.from_ndarray(frame, format="bgr24")):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def write_audio_only(path: Path, seconds: float = 1.0) -> None:
    """Silence in Matroska: a real media file with no video in it."""
    rate = 8000
    with av.open(str(path), "w", format="matroska") as container:
        stream = container.add_stream("flac", rate=rate, layout="mono")
        frame = av.AudioFrame.from_ndarray(
            np.zeros((1, int(rate * seconds)), dtype=np.int16), format="s16", layout="mono"
        )
        frame.rate, frame.pts, frame.time_base = rate, 0, Fraction(1, rate)
        for packet in stream.encode(frame):
            container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
