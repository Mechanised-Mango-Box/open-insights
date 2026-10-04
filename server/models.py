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


@dataclass
class TextSample:
    """One frame read for on-screen text. `reused` marks a frame too like the
    last one read to be worth reading again - it carries that reading."""

    t: float
    words: int
    coverage: float
    reused: bool
    text: str


@dataclass
class TextStats:
    sample_count: int
    mean_words: float
    max_words: int
    mean_coverage: float
    text_frames_ratio: float
    samples: list[TextSample]


@dataclass
class AudioStats:
    """How a video sounds (audio_stats.py). The two None fields are for a video
    with no speech in it, which has no speech level or pitch to report."""

    duration_secs: float
    speech_secs: float
    # Median loudness of the speech, in dBFS.
    speech_level_db: float | None
    # Coherence: the share of the video that is non-speech sound.
    background_sound_ratio: float
    median_pitch_hz: float | None
    # Voice: the standard deviation of the speaker's pitch, in semitones.
    pitch_variation_st: float
