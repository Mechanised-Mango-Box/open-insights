from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID

from typedef.dataset_variants import (
    DatasetOpenCVSceneStats,
    DatasetTranscriptStats,
    DatasetWhisperTranscript,
    DatasetYoutubeAudienceRetention,
    DatasetYoutubeContent,
)
from utils import *


# > MARK: Video
@dataclass(slots=True, kw_only=True)
class Video:
    _id: UUID

    # > File
    file_hash: str | None
    file_path: Path | None

    # > Display/Sorting
    display_name: str

    # > Datasets
    # > YT
    ds_yt_content: "DatasetYoutubeContent | None" = field(default=None, kw_only=True)
    ds_yt_audience_retention: "DatasetYoutubeAudienceRetention | None" = field(
        default=None, kw_only=True
    )
    # > Audio
    ds_whisper_transcript: "DatasetWhisperTranscript | None" = field(
        default=None, kw_only=True
    )
    ds_transcript_stats: "DatasetTranscriptStats | None" = field(
        default=None, kw_only=True
    )

    # > Video
    ds_opencv_scene_stats: "DatasetOpenCVSceneStats | None" = field(
        default=None, kw_only=True
    )
