from typing import Any
from abc import ABC
from abc import abstractmethod
from typing_extensions import Never
from typing_extensions import List
from typing_extensions import Optional
from typing import Tuple
from dataclasses import dataclass
from typing import Generic, TypeVar, Union
import csv
import io

T = TypeVar("T")  # Generic
E = TypeVar("E")  # generic Error


class Ref(Generic[T]):
    def __init__(self, value: T):
        self._: T = value


class RefNullable(Ref[Optional[T]]):
    def __init__(self, value: Optional[T]):
        self._: Optional[T] = value


# region Result types
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


def tuple_to_csv_row(t: Tuple) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(t)
    return output.getvalue().rstrip("\r\n")


# region Container Structs
@dataclass()
class Rowable(ABC):
    _id: ID

    @abstractmethod
    def get_header()-> List[str]:
        assert False

    @abstractmethod
    def as_row(self)-> List[Any]:
        assert False

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

    @staticmethod
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

    @staticmethod
    def csv_header() -> List[str]:
        return [
            "_id",
            "display_name",
            "video_id",
            "yt_hash",
            "yt_title",
            "yt_pub_time",
            "yt_duration",
            "yt_views",
            "yt_watch_time",
            "yt_subscribers",
            "yt_average_view_duration",
            "yt_impressions",
            "yt_impressions_click_through_rate",
        ]

    def to_row(self) -> List:
        return [
            self._id,
            self.display_name,
            self.video_id,
            self.yt_hash,
            self.yt_title,
            self.yt_pub_time,
            self.yt_duration,
            self.yt_views,
            self.yt_watch_time,
            self.yt_subscribers,
            self.yt_average_view_duration,
            self.yt_impressions,
            self.yt_impressions_click_through_rate,
        ]


@dataclass()
class DatasetSnapshot:
    _id: ID

    path: Path
    display_name: str

    source: Optional[str]

    def from_row(row: Tuple):
        return DatasetSnapshot(
            _id=row[0], path=row[1], display_name=row[2], source=row[3]
        )


@dataclass()
class VideoSnapshot(Rowable):
    _id: ID

    path: Path
    display_name: str

    def from_row(row: Tuple):
        return VideoSnapshot(
            _id=row[0],
            path=row[1],
            display_name=row[2],
        )

    @staticmethod
    def csv_header() -> List[str]:
        return VideoSnapshot.get_header()

    def to_row(self) -> List:
        return [
            self._id,
            self.path,
            self.display_name,
        ]

    def get_header():
        return [
            "_id",
            "path",
            "display_name",
        ]

    def as_row(self):
        return self.to_row()

# endregion
