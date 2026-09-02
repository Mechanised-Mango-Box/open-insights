from dataclasses import dataclass
from typing import Literal

FileExt = Literal["mp4", "avi", "mov", "mkv", "webm"]


@dataclass
class Transcript:
    text: str
    count_chars: int
    count_words: int


@dataclass
class SceneStats:
    duration_secs: float
    scenes: float
