"""How a video sounds, for two of Mayer's multimedia principles.

Coherence - leave out extraneous sounds and music. Speech is found by Silero VAD
(the model faster-whisper ships), and loudness is measured over AUDIO_FRAME_SECS
frames. A frame outside speech counts as background sound when it is at least
AUDIO_SILENCE_DBFS and within AUDIO_BACKGROUND_MARGIN_DB of the speaker's median
level. Against the speaker rather than full scale, so a quiet recording is judged
the same as a loud one and room tone falls below it, while music or sound effects
in a pause do not.

    background_sound_ratio  seconds of background sound / duration

Voice - an expressive human voice over a flat or synthetic one. Pitch is tracked
by Praat's autocorrelation method (through parselmouth) and kept only for voiced
frames inside speech, so music in a gap is never taken for the speaker. Each
frame is put in semitones from the median, frames more than an octave out are
dropped as octave errors (the tracker's commonest mistake), and:

    pitch_variation_st  the standard deviation of what is left, in semitones

Semitones rather than Hz so a high voice and a low one are on the same scale.

Speech and pauses (segmenting). The VAD pass above treats any silence under 2 s
as part of the speech around it, which suits coherence but hides every ordinary
pause. A second pass, set to end speech at a SPEECH_MIN_SILENCE_MS silence and
pad it by only SPEECH_PAD_MS, gives:

    speech_ratio        seconds of speech / duration
    pause_rate_per_min  gaps between speech / minutes from first word to last
    mean_pause_secs     the mean length of those gaps

Measured on the audio, not from the transcript: Whisper's segments run
straight across pauses, so a ratio built from them sits near 1 for nearly every
video. Silence before the first word and after the last is an intro or an
outro, not a pause, so neither counts.

A video with no audio track, or no speech in it, is measured as it is - no
background sound it cannot hear, no pitch it cannot track - rather than failed.

Kept apart from processing.py, which loads the Whisper model when imported, so
this can be exercised without one. faster-whisper's audio decoder and VAD load
nothing until called, and parselmouth is imported only when pitch is first
tracked.
"""
from pathlib import Path
from typing import Callable

import av
import numpy as np

from config import (
    AUDIO_BACKGROUND_MARGIN_DB,
    AUDIO_FRAME_SECS,
    AUDIO_SILENCE_DBFS,
    OCTAVE_ERROR_ST,
    PITCH_CEILING_HZ,
    PITCH_FLOOR_HZ,
    PITCH_MIN_VOICED_SECS,
    PITCH_TIME_STEP_SECS,
    SPEECH_MIN_SILENCE_MS,
    SPEECH_PAD_MS,
)
from models import AudioStats

# What faster-whisper decodes to and Silero VAD expects.
SAMPLE_RATE = 16000

# Praat's pitch frames, 10 ms apart by default: its own default for these limits.
_PITCH_TIME_STEP = PITCH_TIME_STEP_SECS

# Pitch is tracked over this much audio at a time. Praat copies the samples to
# float64, and a two-hour lecture in one piece would be most of a gigabyte.
_PITCH_CHUNK_SECS = 60.0

# How many loudness frames are squared at once (2.5 MB each way at 50 ms).
_LEVEL_BLOCK_FRAMES = 4096

# Less voiced speech than this and a standard deviation says nothing.
_MIN_VOICED_SECS = PITCH_MIN_VOICED_SECS

# Pitch frames further than this from the median are octave errors.
_OCTAVE_ERROR_ST = OCTAVE_ERROR_ST

# Speech intervals in seconds, from 16 kHz mono. Injectable so the measuring
# can be tested on synthetic audio no VAD would call speech.
VadFn = Callable[[np.ndarray], list[tuple[float, float]]]

# Pitch frame times (from the start of the audio passed) and frequencies in Hz,
# 0 where unvoiced. Injectable for the same reason.
PitchFn = Callable[[np.ndarray, float, float], tuple[np.ndarray, np.ndarray]]


def silero_vad(audio: np.ndarray, **options: float) -> list[tuple[float, float]]:
    """Silero's speech intervals, with VadOptions' defaults unless overridden."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    return [
        (chunk["start"] / SAMPLE_RATE, chunk["end"] / SAMPLE_RATE)
        for chunk in get_speech_timestamps(
            audio, VadOptions(**options), sampling_rate=SAMPLE_RATE
        )
    ]


def silero_pauses(audio: np.ndarray) -> list[tuple[float, float]]:
    """Speech intervals that end at a short pause rather than a 2 s one."""
    return silero_vad(
        audio, min_silence_duration_ms=SPEECH_MIN_SILENCE_MS, speech_pad_ms=SPEECH_PAD_MS
    )


def praat_pitch(
    audio: np.ndarray, floor_hz: float, ceiling_hz: float
) -> tuple[np.ndarray, np.ndarray]:
    import parselmouth

    pitch = parselmouth.Sound(audio, SAMPLE_RATE).to_pitch_ac(
        time_step=_PITCH_TIME_STEP, pitch_floor=floor_hz, pitch_ceiling=ceiling_hz
    )
    return pitch.xs(), pitch.selected_array["frequency"]


def _decode(file_path: Path) -> tuple[np.ndarray | None, float]:
    """The audio as 16 kHz mono, or None with the container's duration when the
    file has no audio track - faster-whisper's decoder raises on one."""
    try:
        with av.open(str(file_path), metadata_errors="ignore") as container:
            if not container.streams.audio:
                duration = container.duration / av.time_base if container.duration else 0.0
                return None, float(duration)
        from faster_whisper.audio import decode_audio

        audio = decode_audio(str(file_path), sampling_rate=SAMPLE_RATE)
    except av.FFmpegError as e:
        raise RuntimeError(f"The audio could not be read: {e.strerror or e}.") from e
    # decode_audio skips frames it cannot decode, so a truncated file comes back
    # empty rather than raising - and an empty track is not a silent one.
    if len(audio) == 0:
        raise RuntimeError("The file has an audio track, but none of it could be decoded.")
    return audio, len(audio) / SAMPLE_RATE


def _frame_levels(audio: np.ndarray, frame_secs: float) -> np.ndarray:
    """Each whole frame's RMS level in dBFS. A trailing part-frame is left out."""
    frame_len = max(1, round(frame_secs * SAMPLE_RATE))
    count = len(audio) // frame_len
    frames = audio[: count * frame_len].reshape(count, frame_len)
    # Squared in float64 a block at a time: the whole track at once would be
    # another copy of it, twice the size.
    rms = np.empty(count)
    for first in range(0, count, _LEVEL_BLOCK_FRAMES):
        block = frames[first : first + _LEVEL_BLOCK_FRAMES]
        rms[first : first + len(block)] = np.sqrt(np.square(block, dtype=np.float64).mean(axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-10))


def _speech_mask(
    intervals: list[tuple[float, float]], count: int, frame_secs: float
) -> np.ndarray:
    """Which frames speech touches."""
    mask = np.zeros(count, dtype=bool)
    for start, end in intervals:
        first = max(0, int(start / frame_secs))
        last = min(count, int(np.ceil(end / frame_secs)))
        mask[first:last] = True
    return mask


def _merged(intervals: list[tuple[float, float]], duration_secs: float) -> list[list[float]]:
    """Intervals clamped to the audio, sorted, with overlapping ones joined."""
    clamped = sorted(
        (max(0.0, start), min(duration_secs, end))
        for start, end in intervals
        if min(duration_secs, end) > max(0.0, start)
    )
    merged: list[list[float]] = []
    for start, end in clamped:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def _speech_and_pauses(
    intervals: list[tuple[float, float]], duration_secs: float
) -> tuple[float, float, float | None]:
    """speech_ratio, pause_rate_per_min and mean_pause_secs."""
    merged = _merged(intervals, duration_secs)
    if not merged or duration_secs <= 0:
        return 0.0, 0.0, None
    speech_secs = sum(end - start for start, end in merged)
    gaps = [later[0] - earlier[1] for earlier, later in zip(merged, merged[1:])]
    span_mins = (merged[-1][1] - merged[0][0]) / 60
    return (
        round(min(1.0, speech_secs / duration_secs), 5),
        round(len(gaps) / span_mins, 3) if span_mins > 0 else 0.0,
        round(sum(gaps) / len(gaps), 3) if gaps else None,
    )


def _pitch_in_speech(
    audio: np.ndarray,
    speech: np.ndarray,
    frame_secs: float,
    pitch: PitchFn,
    floor_hz: float,
    ceiling_hz: float,
) -> np.ndarray:
    """Voiced pitch frames (Hz) that fall inside speech, chunk by chunk."""
    # Evenly split rather than cut every _PITCH_CHUNK_SECS, so there is no short
    # remainder at the end: Praat refuses a sound shorter than its analysis
    # window (three periods of the floor), and a failed chunk fails the job. A
    # chunk is then only ever that short when the whole audio is, so skipping one
    # with room to spare loses nothing a standard deviation could use.
    count = max(1, round(len(audio) / (_PITCH_CHUNK_SECS * SAMPLE_RATE)))
    bounds = np.linspace(0, len(audio), count + 1).astype(int)
    min_len = max(0.1, 4 / floor_hz) * SAMPLE_RATE
    voiced: list[np.ndarray] = []
    for offset, end in zip(bounds[:-1], bounds[1:]):
        first = int(offset / SAMPLE_RATE / frame_secs)
        last = int(end / SAMPLE_RATE / frame_secs) + 1
        if end - offset < min_len or not speech[first:last].any():
            continue  # Too short to track, or nothing here would be kept.
        times, freqs = pitch(audio[offset:end], floor_hz, ceiling_hz)
        frames = ((times + offset / SAMPLE_RATE) / frame_secs).astype(int)
        in_speech = speech[np.clip(frames, 0, len(speech) - 1)] & (frames < len(speech))
        voiced.append(freqs[(freqs > 0) & in_speech])
    return np.concatenate(voiced) if voiced else np.empty(0)


def calculate_audio_stats(
    file_path: Path,
    vad: VadFn | None = None,
    pitch: PitchFn | None = None,
    frame_secs: float = AUDIO_FRAME_SECS,
    margin_db: float = AUDIO_BACKGROUND_MARGIN_DB,
    silence_dbfs: float = AUDIO_SILENCE_DBFS,
    floor_hz: float = PITCH_FLOOR_HZ,
    ceiling_hz: float = PITCH_CEILING_HZ,
    pause_vad: VadFn | None = None,
) -> AudioStats:
    audio, duration_secs = _decode(file_path)
    if audio is None:
        return AudioStats(
            duration_secs=round(duration_secs, 3),
            speech_secs=0.0,
            speech_level_db=None,
            background_sound_ratio=0.0,
            median_pitch_hz=None,
            pitch_variation_st=0.0,
            speech_ratio=0.0,
            pause_rate_per_min=0.0,
            mean_pause_secs=None,
        )
    # An injected VAD stands in for both passes unless a second one is given.
    return measure_audio(
        audio,
        vad or silero_vad,
        pitch or praat_pitch,
        frame_secs,
        margin_db,
        silence_dbfs,
        floor_hz,
        ceiling_hz,
        pause_vad or (vad if vad else silero_pauses),
    )


def measure_audio(
    audio: np.ndarray,
    vad: VadFn,
    pitch: PitchFn,
    frame_secs: float = AUDIO_FRAME_SECS,
    margin_db: float = AUDIO_BACKGROUND_MARGIN_DB,
    silence_dbfs: float = AUDIO_SILENCE_DBFS,
    floor_hz: float = PITCH_FLOOR_HZ,
    ceiling_hz: float = PITCH_CEILING_HZ,
    pause_vad: VadFn | None = None,
) -> AudioStats:
    """The measuring itself, on 16 kHz mono already decoded. `pause_vad` is the
    short-pause pass; left out, `vad` serves for both."""
    duration_secs = len(audio) / SAMPLE_RATE
    levels = _frame_levels(audio, frame_secs)
    speech = _speech_mask(vad(audio) if len(levels) else [], len(levels), frame_secs)

    speech_level_db = float(np.median(levels[speech])) if speech.any() else None
    threshold = silence_dbfs
    if speech_level_db is not None:
        threshold = max(silence_dbfs, speech_level_db - margin_db)
    background_secs = float(np.count_nonzero(~speech & (levels >= threshold))) * frame_secs

    median_pitch_hz = None
    pitch_variation_st = 0.0
    voiced = _pitch_in_speech(audio, speech, frame_secs, pitch, floor_hz, ceiling_hz)
    if len(voiced) * _PITCH_TIME_STEP >= _MIN_VOICED_SECS:
        median = float(np.median(voiced))
        semitones = 12 * np.log2(voiced / median)
        kept = semitones[np.abs(semitones) <= _OCTAVE_ERROR_ST]
        if len(kept) * _PITCH_TIME_STEP >= _MIN_VOICED_SECS:
            median_pitch_hz = round(median, 2)
            pitch_variation_st = round(float(np.std(kept, ddof=1)), 4)

    speech_ratio, pause_rate_per_min, mean_pause_secs = _speech_and_pauses(
        (pause_vad or vad)(audio) if len(levels) else [], duration_secs
    )

    return AudioStats(
        duration_secs=round(duration_secs, 3),
        speech_secs=round(float(np.count_nonzero(speech)) * frame_secs, 3),
        speech_level_db=None if speech_level_db is None else round(speech_level_db, 2),
        background_sound_ratio=round(min(1.0, background_secs / duration_secs), 5)
        if duration_secs > 0
        else 0.0,
        median_pitch_hz=median_pitch_hz,
        pitch_variation_st=pitch_variation_st,
        speech_ratio=speech_ratio,
        pause_rate_per_min=pause_rate_per_min,
        mean_pause_secs=mean_pause_secs,
    )
