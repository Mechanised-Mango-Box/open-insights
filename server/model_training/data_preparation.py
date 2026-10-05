"""
Data Preparation Module for Model Training.

Turns a client export (the `open-insights-export-<timestamp>` zip, or that zip
unpacked into a folder) into the table the models train on: one row per video,
FEATURE_COLUMNS plus TARGET_COLUMN.

Only the export's manifest.json is read. The transcripts and video files beside
it are not needed - Scan already reduced them to the stats the manifest carries -
so an export made with or without video files trains the same model.

The features are computed exactly as the client's Analysis page computes them
(buildVideoFeatures / AnalysisService.buildFeatureRows in
client/src/app/data-management/analysis/analysis.service.ts), because the server
scores features the client sends it: a model trained on differently-derived
numbers would be scoring inputs it never saw.

    duration               scene_stats.duration_secs / 60        (minutes)
    wpm                    count_words / duration
    scene_change_rate      scenes / duration                      (per minute)
    word_count             count_words
    speech_pace_variation  transcript_stats, as-is                (WPM std dev)
    speech_ratio           audio_stats, as-is                     (0-1)
    text_density           text_stats.mean_words                  (words on screen)
    mean_pause_secs        audio_stats, as-is                     (seconds)
    average_percentage_viewed
                           average_view_duration_secs / scene_stats.duration_secs * 100

speech_ratio is speech heard in the audio by voice activity detection, not the
share of the video Whisper's segments cover - those run across pauses, so that
share sits near 1 for nearly every video.

A record is skipped, as the client skips it, when its scene, transcript, text or
audio stats are missing, its duration is not positive, its speech features are null
(Scan had no duration to measure them against, or the audio was scanned before
speech and pauses were measured), it has fewer than two stretches of speech (so no
pause to average), or it has no YouTube average view duration.

A model can learn from a subset of the features (FEATURE_SETS), and then only the
scans those features come from are required. Duration is read from scene stats
when the set has a scene feature to divide by it, and from audio stats otherwise,
so a model without scene features never needs the scene scan. The client makes the
same choice (durationSourceFor in client/src/app/data-management/analysis/stats.ts).
"""
import json
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

# Standard Feature and Target Definitions
FEATURE_COLUMNS: List[str] = [
    "duration",
    "wpm",
    "scene_change_rate",
    "word_count",
    "speech_pace_variation",
    "speech_ratio",
    "text_density",
    "mean_pause_secs",
]

TARGET_COLUMN: str = "average_percentage_viewed"

# The feature subsets the published models are trained on, by model id. "fast"
# leaves out on-screen text: OCR is the slowest scan by far (about 7 s per minute
# of 1080p video, against 4 s for scene stats, 1.3 s for transcription and 0.3 s
# for audio stats, measured on a 16-core CPU).
FEATURE_SETS: Dict[str, List[str]] = {
    "full": list(FEATURE_COLUMNS),
    "fast": [
        "duration",
        "wpm",
        "scene_change_rate",
        "word_count",
        "speech_pace_variation",
        "speech_ratio",
        "mean_pause_secs",
    ],
    "video": ["duration", "scene_change_rate", "text_density"],
    "audio": [
        "duration",
        "wpm",
        "word_count",
        "speech_pace_variation",
        "speech_ratio",
        "mean_pause_secs",
    ],
}

# Which scan results each feature is computed from, besides the duration every
# rate is divided by (see duration_source).
FEATURE_SOURCES: Dict[str, Tuple[str, ...]] = {
    "duration": (),
    "wpm": ("transcript_stats",),
    "scene_change_rate": ("scene_stats",),
    "word_count": ("transcript_stats",),
    "speech_pace_variation": ("transcript_stats",),
    "speech_ratio": ("audio_stats",),
    "text_density": ("text_stats",),
    "mean_pause_secs": ("audio_stats",),
}

# How each feature is computed, in words. Copied into every model card, so a
# model says what its inputs mean wherever it travels.
FEATURE_DEFINITIONS: Dict[str, str] = {
    "duration": "Video length in minutes (scene stats, or audio stats when the model uses no scene feature).",
    "wpm": "Transcript word count / duration in minutes (Whisper transcript).",
    "scene_change_rate": "Scene cuts per minute: scene stats' cut count / duration in minutes.",
    "word_count": "Words in the Whisper transcript.",
    "speech_pace_variation": "Standard deviation of words per minute across 30 s windows of the transcript.",
    "speech_ratio": "Seconds of speech heard by Silero VAD / video length (0-1).",
    "text_density": "Mean number of words on screen per sampled frame (RapidOCR).",
    "mean_pause_secs": "Mean length in seconds of the gaps between stretches of speech (Silero VAD).",
}

TARGET_DEFINITION: str = (
    "Average percentage viewed: YouTube's average view duration / video duration x 100."
)

# Below this there is too little to split 80/20 and still fit eight features.
MIN_TRAINING_ROWS = 10


def duration_source(features: List[str]) -> str:
    """The scan result a feature set reads its duration from."""
    return "scene_stats" if "scene_change_rate" in features else "audio_stats"


def required_sources(features: List[str]) -> List[str]:
    """Every scan result a feature set needs, duration's included, in a fixed order."""
    needed = {duration_source(features)}
    for name in features:
        needed.update(FEATURE_SOURCES[name])
    order = ["scene_stats", "transcript_stats", "text_stats", "audio_stats"]
    return [source for source in order if source in needed]


def _read_manifest(path: Path) -> Dict[str, Any]:
    if path.is_dir():
        manifest_path = path / "manifest.json"
        if not manifest_path.is_file():
            raise ValueError(f"{path} is not an export: manifest.json is missing.")
        return json.loads(manifest_path.read_text(encoding="utf-8"))

    if path.is_file() and zipfile.is_zipfile(path):
        # Only the manifest is opened, so the video files an export may carry are
        # never read - an export of a whole library runs to gigabytes.
        with zipfile.ZipFile(path) as archive:
            try:
                return json.loads(archive.read("manifest.json").decode("utf-8"))
            except KeyError:
                raise ValueError(f"{path} is not an export: manifest.json is missing.") from None

    raise ValueError(f"{path} is neither an export folder nor an export .zip.")


_MISSING_REASONS = {
    "scene_stats": "missing scene stats",
    "transcript_stats": "missing transcript stats",
    "text_stats": "missing text stats",
    "audio_stats": "missing audio stats",
}


def _record_to_row(
    record: Dict[str, Any], features: List[str] = FEATURE_COLUMNS
) -> Tuple[Optional[Dict[str, float]], Optional[str]]:
    """The training row for one manifest record, or None and the reason it was skipped.

    Only the scans `features` come from are required, so a record missing an
    unrelated scan still trains a model that does not use it.
    """
    sources = {}
    for source in required_sources(features):
        sources[source] = record.get(source)
        if not sources[source]:
            return None, _MISSING_REASONS[source]

    duration_secs = sources[duration_source(features)].get("duration_secs") or 0
    if duration_secs <= 0:
        return None, "no positive duration"

    transcript_stats = sources.get("transcript_stats") or {}
    audio_stats = sources.get("audio_stats") or {}
    if "speech_pace_variation" in features and transcript_stats.get("speech_pace_variation") is None:
        return None, "speech features not measured"
    if "speech_ratio" in features and audio_stats.get("speech_ratio") is None:
        return None, "speech features not measured"
    if "mean_pause_secs" in features and audio_stats.get("mean_pause_secs") is None:
        return None, "speech never paused, so no mean pause"

    average_view_duration_secs = (record.get("youtube_content") or {}).get(
        "average_view_duration_secs"
    )
    if average_view_duration_secs is None:
        return None, "no YouTube average view duration"

    duration_mins = duration_secs / 60
    compute = {
        "duration": lambda: duration_mins,
        "wpm": lambda: transcript_stats["count_words"] / duration_mins,
        "scene_change_rate": lambda: sources["scene_stats"]["scenes"] / duration_mins,
        "word_count": lambda: transcript_stats["count_words"],
        "speech_pace_variation": lambda: transcript_stats["speech_pace_variation"],
        "speech_ratio": lambda: audio_stats["speech_ratio"],
        "text_density": lambda: sources["text_stats"]["mean_words"],
        "mean_pause_secs": lambda: audio_stats["mean_pause_secs"],
    }
    row = {name: compute[name]() for name in features}
    row[TARGET_COLUMN] = average_view_duration_secs / duration_secs * 100
    return row, None


def load_export_dataset(
    path: str | Path, verbose: bool = True, features: Optional[List[str]] = None
) -> pd.DataFrame:
    """
    Loads a client export (folder or .zip) as a training DataFrame, with columns
    `features` (default: all of FEATURE_COLUMNS) plus TARGET_COLUMN.

    Raises ValueError when the path is not an export, or when fewer than
    MIN_TRAINING_ROWS of its records have everything a training row needs.
    """
    features = list(features or FEATURE_COLUMNS)
    _check_features(features)
    path = Path(path)
    manifest = _read_manifest(path)
    records = manifest.get("records")
    if not isinstance(records, list):
        raise ValueError(f"{path}: manifest.json is malformed - no records array.")

    rows: List[Dict[str, float]] = []
    skipped: Counter = Counter()
    for record in records:
        row, reason = _record_to_row(record, features)
        if row is None:
            skipped[reason] += 1
        else:
            rows.append(row)

    if verbose:
        print(f"[ Data ] {path.name}: {len(rows)} of {len(records)} record(s) usable for training.")
        for reason, count in skipped.most_common():
            print(f"  skipped {count}: {reason}")

    if len(rows) < MIN_TRAINING_ROWS:
        raise ValueError(
            f"{path}: only {len(rows)} usable record(s), need at least {MIN_TRAINING_ROWS}. "
            f"Run Scan ({', '.join(required_sources(features))}) and import the YouTube "
            "content report for more videos, then export again."
        )

    return pd.DataFrame(rows, columns=features + [TARGET_COLUMN])


def _check_features(features: List[str]) -> None:
    unknown = [name for name in features if name not in FEATURE_COLUMNS]
    if unknown or not features:
        raise ValueError(f"Unknown or empty feature list: {unknown or features}")


def prepare_training_data(
    raw_df: pd.DataFrame, features: Optional[List[str]] = None
) -> pd.DataFrame:
    """
    Validates a training DataFrame and narrows it to the feature and target columns.
    Load one from an export with load_export_dataset().
    """
    features = list(features or FEATURE_COLUMNS)
    _check_features(features)
    required_cols = features + [TARGET_COLUMN]
    missing = [col for col in required_cols if col not in raw_df.columns]
    if missing:
        raise ValueError(f"Missing required columns in dataset: {missing}")
    return raw_df[required_cols].dropna()
