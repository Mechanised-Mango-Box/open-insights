"""Asking FFmpeg about a video file, through PyAV.

PyAV is here as faster-whisper's audio decoder, and its wheels carry an FFmpeg of
their own - one that decodes AV1 in software (dav1d). That makes it the second
opinion for the two things OpenCV cannot be left to answer alone:

- Whether an upload is a video at all. check_video() is the upload route's content
  check. The route used to go by the name, so anything called .mp4 was stored and
  queued, and only failed - once per dataset kind - when a worker came to decode it.
- Decoding a codec OpenCV opens but cannot read. The opencv-python wheels decode
  AV1 only through hardware, so on a machine without it an AV1 file opens, reports
  its frame count and rate, and then fails every read. pyav_video() is what scene
  stats and text stats fall back to when that happens.
"""
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import av
from av.stream import Disposition

from models import FileExt
from utils import Failure, Result, Success

# The FFmpeg demuxer each accepted extension has to turn out to be. A demuxer is
# named for every format it reads ("mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm"), so
# .mp4 and .mov pass as each other, as do .mkv and .webm: each pair is one
# container, and every decoder here reads it by content, not by name.
DEMUXERS: dict[FileExt, str] = {
    "mp4": "mp4",
    "mov": "mov",
    "mkv": "matroska",
    "webm": "webm",
    "avi": "avi",
}

# How many of the video stream's packets check_video() reads looking for a first
# frame. A decoder holds a few back before its first output (B-frame reordering);
# this many without one is a stream it cannot decode.
_FIRST_FRAME_PACKETS = 300


def _video_stream(container: av.container.InputContainer) -> av.VideoStream | None:
    # The stream OpenCV would pick: both go through av_find_best_stream. Cover art
    # is a one-frame "video" stream that an audio file can carry, not a video.
    stream = container.streams.best("video")
    if stream is None or stream.disposition & Disposition.attached_pic:
        return None
    return stream


def check_video(file_path: Path, file_ext: FileExt) -> Result[str, str]:
    """Whether the file is a video this server can process, in the container its
    name says it is. Success carries the video codec's name; Failure says why not,
    in words meant for whoever uploaded it."""
    try:
        with av.open(str(file_path), metadata_errors="ignore") as container:
            if DEMUXERS[file_ext] not in container.format.name.split(","):
                return Failure(
                    f"The file is named .{file_ext} but holds "
                    f"{container.format.long_name}, which is not a .{file_ext} video."
                )
            stream = _video_stream(container)
            if stream is None:
                return Failure("The file holds no video, only audio or other data.")

            codec = stream.codec_context.codec.canonical_name
            for index, packet in enumerate(container.demux(stream)):
                if packet.decode():
                    return Success(codec)
                if index >= _FIRST_FRAME_PACKETS:
                    break
            return Failure(f"No frame of its {codec} video could be decoded.")
    except av.FFmpegError as e:
        return Failure(f"The file could not be read as a video: {e.strerror or e}.")


@contextmanager
def pyav_video(file_path: Path) -> Iterator[tuple[float | None, Iterator[av.VideoFrame]]]:
    """The file's video stream, decoded by PyAV: its duration in seconds, or None
    when the file does not say, and its frames in order."""
    with av.open(str(file_path), metadata_errors="ignore") as container:
        stream = _video_stream(container)
        if stream is None:
            raise RuntimeError("The file holds no video stream.")
        stream.thread_type = "AUTO"
        if stream.duration is not None and stream.time_base is not None:
            duration_secs = float(stream.duration * stream.time_base)
        elif container.duration is not None:
            duration_secs = container.duration / av.time_base
        else:
            duration_secs = None
        yield duration_secs, container.decode(stream)


def codec_name(file_path: Path) -> str:
    """The video codec's name, for an error message; "unknown" if even that
    cannot be read."""
    try:
        with av.open(str(file_path), metadata_errors="ignore") as container:
            stream = _video_stream(container)
            return stream.codec_context.codec.canonical_name if stream else "unknown"
    except Exception:
        return "unknown"
