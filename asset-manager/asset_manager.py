from typing import List, Dict, Optional, Any
from datetime import datetime, timezone
from sqlite3 import connect
from sqlite3 import Connection, Row, IntegrityError
import json
import csv
from dataclasses import dataclass

Path = str
CustomResourceType = str
ID = int
DatasetFileLabel = str


# region Setup
def connect_db(db_path: Path = "media_indexer.sqlite") -> Connection:
    print("[ Asset Manager ] Connecting to DB.")
    c: Connection = connect(db_path)
    c.execute("PRAGMA foreign_keys = ON;")
    return c


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


def setup_schema(c: Connection):
    print("[ Asset Manager ] Loading schema.")
    c.executescript(
        """
    CREATE TABLE IF NOT EXISTS entity (
        _id INTEGER PRIMARY KEY,

        -- Display
        display_name TEXT,

        -- Binary
        video_id INTEGER,

        -- Youtube
        yt_hash TEXT, -- This is the "content" field
        yt_title TEXT,
        yt_pub_time DATE,
        yt_duration INTEGER, -- In seconds
        yt_views INTEGER,
        yt_watch_time REAL, -- In hours
        yt_subscribers INTEGER,
        yt_average_view_duration INTEGER, -- Converted from hh:mm:ss to seconds
        yt_impressions INTEGER,
        yt_impressions_click_through_rate REAL -- As a percentage
    );

    CREATE TABLE IF NOT EXISTS file_video (
        _id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_dataset (
        _id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS link_entity_dataset (
        entity_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        dataset_id INTEGER NOT NULL,
        
        -- Ensures a unique label per entity directly at the table level
        PRIMARY KEY (entity_id, label),
        
        FOREIGN KEY (entity_id) REFERENCES entity(_id) 
            ON DELETE CASCADE,
        FOREIGN KEY (dataset_id) REFERENCES file_dataset(_id) 
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS model (
        _id INTEGER PRIMARY KEY,
        display_name TEXT,
        path TEXT NOT NULL UNIQUE
    );
    """
    )
    c.commit()


# endregion


# region File tracking
def register_file_dataset(c: Connection, path: Path) -> int:
    print(f"[ Asset Manager ] Registering file (data): {path}")
    try:
        cursor = c.execute(
            """
            INSERT INTO file_dataset (path)
            VALUES (?)
            """,
            (path,),
        )
        c.commit()
        return cursor.lastrowid
    except IntegrityError:
        raise ValueError(f"File data already exists for path: {path}")


def register_file_video(c: Connection, path: Path) -> int:
    print(f"[ Asset Manager ] Registering file (video): {path}")
    try:
        cursor = c.execute(
            """
            INSERT INTO file_video (path)
            VALUES (?)
            """,
            (path,),
        )
        c.commit()
        return cursor.lastrowid
    except IntegrityError:
        raise ValueError(f"Video file already exists for path: {path}")


# endregion


# region Entity management
def new_entity(c: Connection) -> ID:
    print(f"[ Asset Manager ] Creating new entity...")
    cur = c.execute(
        "INSERT INTO entity (display_name, video_id) VALUES (?, ?)",
        (None, None),
    )
    c.commit()
    return cur.lastrowid


def upsert_entity_video(c: Connection, entity_id: ID, video_id: ID):
    print(f"[ Asset Manager ] Updating entity (id={entity_id}).")
    c.execute(
        """
        UPDATE entity
        SET video_id = ?
        WHERE _id = ?
        """,
        (video_id, entity_id),
    )

    if c.execute("SELECT changes()").fetchone()[0] == 0:
        raise ValueError(f"Entity not found: id={entity_id}")

    c.commit()


def upsert_entity_data(
    c: Connection, entity_id: ID, dataset_id: ID, label: DatasetFileLabel
):
    print(f"[ Asset Manager ] Updating entity (id={entity_id}).")

    c.execute(
        """
        INSERT INTO link_entity_dataset (entity_id, label, dataset_id)
        VALUES (?, ?, ?)
        ON CONFLICT(entity_id, label)
        DO UPDATE SET dataset_id = excluded.dataset_id
        """,
        (entity_id, label, dataset_id),
    )
    c.commit()


# endregion


# region File utils
def parse_csv_to_dict(
    file_path: Path, *, delimiter=",", has_header=True
) -> Dict[str, List[str]]:
    with open(file_path, newline="", encoding="utf-8") as f:
        if has_header:
            reader = csv.DictReader(f, delimiter=delimiter)
            if reader.fieldnames is None:
                return {}
            out: Dict[str, List[str]] = {name: [] for name in reader.fieldnames}
            for row in reader:
                for k, v in row.items():
                    out[k].append("" if v is None else v)
            return out
        else:
            reader = csv.reader(f, delimiter=delimiter)
            out: Dict[str, List[str]] = {}
            for row in reader:
                for i, cell in enumerate(row):
                    key = f"column{i}"
                    out.setdefault(key, []).append(cell)
            return out


# endregion


def find_entity_ids_from_yt_title(c: Connection, title: str) -> List[ID]:
    cur = c.execute(
        """
        SELECT _id FROM entity
        WHERE yt_title = ?
        """,
        (title,),
    )
    rows = cur.fetchall()
    return [row[0] for row in rows]


def find_entity_ids_from_yt_hash(c: Connection, yt_hash: str) -> List[ID]:
    cur = c.execute(
        """
        SELECT _id FROM entity
        WHERE yt_hash = ?
        """,
        (yt_hash,),
    )
    rows = cur.fetchall()
    return [row[0] for row in rows]
