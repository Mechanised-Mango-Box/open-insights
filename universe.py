from typing import Tuple
from utils import ID
from typing import List
from dataclasses import dataclass
from sqlite3 import Connection

@dataclass(frozen=True)
class EntitySnapshot:
    _id: ID

    display_name: str

    video_id: int

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

    def from_row(row: Tuple) -> "EntitySnapshot":
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


class Universe:
    db: Connection

    entity_snapshots: List[EntitySnapshot] = []