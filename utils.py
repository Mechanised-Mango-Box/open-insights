from dataclasses import fields
from pathlib import Path
from uuid import UUID
from dataclasses import field
from typing_extensions import Sequence
from typing_extensions import Set
from typing import Self
from typing import Literal
from typing_extensions import Dict
from typing import Any
from abc import ABC
from abc import abstractmethod
from typing_extensions import Never
from typing_extensions import List
from typing_extensions import Optional
from typing import Tuple
from dataclasses import dataclass, asdict, astuple
from typing import Generic, TypeVar, Union
import csv
import io
import hashlib

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
CustomResourceType = str
ID = int
DatasetFileLabel = str
# endregion


def tuple_to_csv_row(t: Tuple) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(t)
    return output.getvalue().rstrip("\r\n")


def file_hash(path: Path, algo: str = "sha256", chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.new(algo)
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


# region Container Structs
# @dataclass()
# class Rowable(ABC):
#     _id: ID

#     @abstractmethod
#     def get_header() -> List[str]:
#         assert False

#     @abstractmethod
#     def to_row(self) -> List[Any]:
#         assert False

#     @abstractmethod
#     def from_row(self, row: List[str]) -> Result[Self, str]:
#         assert False
#         return Failure("Implement Method")


# @dataclass()
# class EntitySnapshot:
#     _id: ID

#     display_name: str

#     video_id: Optional[int]

#     yt_hash: str
#     yt_title: str
#     yt_pub_time: str
#     yt_duration: int
#     yt_views: int
#     yt_watch_time: float
#     yt_subscribers: int
#     yt_average_view_duration: int
#     yt_impressions: int
#     yt_impressions_click_through_rate: float

#     @staticmethod
#     def from_row(row: Tuple):
#         return EntitySnapshot(
#             _id=row[0],
#             display_name=row[1],
#             video_id=row[2],
#             yt_hash=row[3],
#             yt_title=row[4],
#             yt_pub_time=row[5],
#             yt_duration=row[6],
#             yt_views=row[7],
#             yt_watch_time=row[8],
#             yt_subscribers=row[9],
#             yt_average_view_duration=row[10],
#             yt_impressions=row[11],
#             yt_impressions_click_through_rate=row[12],
#         )

#     @staticmethod
#     def csv_header() -> List[str]:
#         return [
#             "_id",
#             "display_name",
#             "video_id",
#             "yt_hash",
#             "yt_title",
#             "yt_pub_time",
#             "yt_duration",
#             "yt_views",
#             "yt_watch_time",
#             "yt_subscribers",
#             "yt_average_view_duration",
#             "yt_impressions",
#             "yt_impressions_click_through_rate",
#         ]

#     def to_row(self) -> List:
#         return [
#             self._id,
#             self.display_name,
#             self.video_id,
#             self.yt_hash,
#             self.yt_title,
#             self.yt_pub_time,
#             self.yt_duration,
#             self.yt_views,
#             self.yt_watch_time,
#             self.yt_subscribers,
#             self.yt_average_view_duration,
#             self.yt_impressions,
#             self.yt_impressions_click_through_rate,
#         ]


# @dataclass()
# class DatasetSnapshot:
#     _id: ID

#     path: Path
#     display_name: str

#     source: Optional[str]

#     def from_row(row: Tuple):
#         return DatasetSnapshot(_id=row[0], path=row[1], display_name=row[2], source=row[3])


# @dataclass()
# class VideoSnapshot(Rowable):
#     _id: ID

#     path: Path
#     display_name: str

#     def from_row(row: Tuple):
#         return VideoSnapshot(
#             _id=row[0],
#             path=row[1],
#             display_name=row[2],
#         )

#     @staticmethod
#     def csv_header() -> List[str]:
#         return VideoSnapshot.get_header()

#     def to_row(self) -> List:
#         return [
#             self._id,
#             self.path,
#             self.display_name,
#         ]

#     def get_header():
#         return [
#             "_id",
#             "path",
#             "display_name",
#         ]

#     def to_row(self):
#         return self.to_row()


# endregion


@dataclass(slots=True, kw_only=True)
class Dataset(ABC):
    @staticmethod
    @abstractmethod
    def get_label() -> str:
        assert False

    @classmethod
    def get_fieldnames(cls) -> list[str]:
        return [field.name for field in fields(cls)]


@dataclass(slots=True)
class DatasetYoutubeContent(Dataset):
    @staticmethod
    def get_label():
        return "yt_content"

    yt_id: str
    title: str
    pub_time: str
    duration: int
    views: int
    watch_time: float
    subscribers: int
    average_view_duration: str
    impressions: int
    impressions_click_through_rate: float | None


@dataclass(slots=True)
class DatasetYoutubeAudienceRetention(Dataset):
    @staticmethod
    def get_label():
        return "yt_audience_retention"

    video_positions: List[int]
    absolute_audience_retention: List[float]


@dataclass(slots=True, kw_only=True)
class DatasetWhisperTranscript(Dataset):
    @staticmethod
    def get_label():
        return "whisper_transcript"

    transcript: str


@dataclass(slots=True, kw_only=True)
class DatasetTranscriptStats(Dataset):
    @staticmethod
    def get_label():
        return "transcript_stats"

    word_count: int


@dataclass(slots=True, kw_only=True)
class DatasetOpenCVSceneStats(Dataset):
    @staticmethod
    def get_label():
        return "opencv_scene_stats"

    duration_minutes: float
    scene_transition_count: int
    scene_transition_rate: float


# Dataset: type = (
#     DatasetYoutubeContent
#     | DatasetYoutubeAudienceRetention
#     | DatasetWhisperTranscript
#     | DatasetTranscriptStats
#     | DatasetOpenCVSceneStats
# )

# def row_to_arr(obj: Rowable) -> Result[Sequence, str]:
#     match obj:
#         case Entity():
#             return Success(astuple(obj))
#         case DatasetYoutubeContent():
#             return Success(astuple(obj))
#         case _:
#             return Failure("Not a rowable type.")

# def arr_to_row(arr: Tuple, ptr_row: Rowable) -> Result[None, str]:
#     match ptr_row:
#         case Entity():


#             return Failure("Not implemented yet.")
#         case DatasetYoutubeContent():
#             ptr_row.yt_id = arr[0]
#             ptr_row.title = arr[1]
#             ptr_row.pub_time = arr[2]
#             ptr_row.duration = int(arr[3])
#             ptr_row.views = int(arr[4])
#             ptr_row.watch_time = float(arr[5])
#             ptr_row.subscribers = int(arr[6])
#             ptr_row.average_view_duration = int(arr[7])
#             ptr_row.impressions = int(arr[8])
#             ptr_row.impressions_click_through_rate = float(arr[9])
#             return Success(None)
#         case _:
#             return Failure("Not a rowable type.")
@dataclass(slots=True, kw_only=True)
class Video:
    _id: UUID

    # > File
    file_hash: Optional[str]
    file_path: Optional[Path]

    # > Display/Sorting
    display_name: str

    # > Datasets
    # > YT
    ds_yt_content: Optional[DatasetYoutubeContent] = field(default=None, kw_only=True)
    ds_yt_audience_retention: Optional[DatasetYoutubeAudienceRetention] = field(
        default=None, kw_only=True
    )
    # > Audio
    ds_whisper_transcript: Optional[DatasetWhisperTranscript] = field(default=None, kw_only=True)
    ds_transcript_stats: Optional[DatasetTranscriptStats] = field(default=None, kw_only=True)

    # > Video
    ds_opencv_scene_stats: Optional[DatasetOpenCVSceneStats] = field(default=None, kw_only=True)
