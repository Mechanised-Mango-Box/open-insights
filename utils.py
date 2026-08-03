from typing_extensions import Optional
from typing import Tuple
from dataclasses import dataclass
from typing import Generic, TypeVar, Union

# region Result types
T = TypeVar("T")
E = TypeVar("E")


@dataclass(frozen=True)
class Success(Generic[T]):
    value: T


@dataclass(frozen=True)
class Failure(Generic[E]):
    error: E


Result = Union[Success[T], Failure[E]]
# endregion

# region Custom type aliases
Path = str
CustomResourceType = str
ID = int
DatasetFileLabel = str
# endregion


# region Container Structs
@dataclass()
class EntitySnapshot:
    _id: ID

    display_name: str

    video_id: Optional[int]

    yt_hash: str
    yt_title: str
    yt_pub_time: str
    yt_duration: int
    yt_views: int
    yt_watch_time: float
    yt_subscribers: int
    yt_average_view_duration: int
    yt_impressions: int
    yt_impressions_click_through_rate: float

    def from_row(row: Tuple):
        return EntitySnapshot(
            _id=row[0],
            display_name=row[1],
            video_id=row[2],
            yt_hash=row[3],
            yt_title=row[4],
            yt_pub_time=row[5],
            yt_duration=row[6],
            yt_views=row[7],
            yt_watch_time=row[8],
            yt_subscribers=row[9],
            yt_average_view_duration=row[10],
            yt_impressions=row[11],
            yt_impressions_click_through_rate=row[12],
        )


@dataclass()
class DatasetSnapshot:
    _id: ID

    path: Path

    def from_row(row: Tuple):
        return DatasetSnapshot(
            _id=row[0],
            path=row[1],
        )

@dataclass(frozen=True)
class VideoSnapshot:
    _id: ID

    path: Path

    def from_row(row: Tuple):
        return VideoSnapshot(
            _id=row[0],
            path=row[1],
        )


# endregion
