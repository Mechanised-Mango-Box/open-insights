from dataclasses import dataclass
from typing import Literal

FileExt = Literal["mp4", "avi", "mov", "mkv", "webm"]


@dataclass
class YoutubeContentReport:
    content: str | None = None
    engaged_views: int | None = None
    average_percentage_viewed: float | None = None
    stayed_to_watch: float | None = None
    unique_viewers: int | None = None
    unique_reach: int | None = None
    average_views_per_viewer: float | None = None
    new_viewers: int | None = None
    regular_viewers: int | None = None
    casual_viewers: int | None = None
    returning_viewers: int | None = None
    views: int | None = None
    watch_time_hours: float | None = None
    subscribers: int | None = None
    average_view_duration_secs: int | None = None
    impressions: int | None = None
    impressions_click_through_rate: float | None = None


@dataclass
class YoutubeAudienceRetention:
    video_position: list[float]
    absolute_audience_retention: list[float]


@dataclass
class Transcript:
    text: str
    count_chars: int
    count_words: int


@dataclass
class SceneStats:
    duration_secs: float
    scenes: float
