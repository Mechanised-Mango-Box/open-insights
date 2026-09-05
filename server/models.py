from dataclasses import dataclass
from typing import Literal

FileExt = Literal["mp4", "avi", "mov", "mkv", "webm"]


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


@dataclass
class Transcript:
    count_chars: int
    count_words: int
    segments: list[TranscriptSegment]


@dataclass
class SceneStats:
    duration_secs: float
    scenes: float
