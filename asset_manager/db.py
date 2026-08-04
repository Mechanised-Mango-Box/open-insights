from utils import DatasetSnapshot
from utils import EntitySnapshot
from utils import VideoSnapshot
from typing import Tuple
from utils import *
from typing import List, Dict, Any
from datetime import datetime, timezone
from sqlite3 import connect
from sqlite3 import Connection, Row, IntegrityError
from dataclasses import dataclass
from utils import Result, Success, Failure


# region Setup
def connect_db(db_path: Path) -> Connection:
    print("[ Asset Manager ] Connecting to DB.")
    c: Connection = connect(db_path)
    c.execute("PRAGMA foreign_keys = ON;")
    return c


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
        path TEXT UNIQUE NOT NULL,

        display_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_dataset (
        _id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,

        display_name TEXT NOT NULL,
        source TEXT
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
def find_file_dataset(c: Connection, path: Path) -> Result[ID, None]:
    cursor = c.execute(
        """
        SELECT _id FROM file_dataset
        WHERE path=?
        """,
        (path,),
    )

    res = cursor.fetchone()
    if res is None:
        return Failure(None)
    return Success(res[0])


def find_entities_using_dataset(c: Connection, dataset_id: ID) -> List[ID]:
    cursor = c.execute(
        """
        SELECT entity_id FROM link_entity_dataset
        WHERE dataset_id=?
        """,
        (dataset_id,),
    )
    res = cursor.fetchall()
    return list(map(lambda row: row[0], res))


def register_file_dataset(c: Connection, snap: DatasetSnapshot) -> Result[int, str]:
    print(f"[ Asset Manager ] Registering file (data): {snap}")
    try:
        assert snap._id <= 0, "Potentially attempting to insert an existing record."
        cursor = c.execute(
            """
            INSERT INTO file_dataset (path, display_name, source)
            VALUES (?, ?, ?)
            """,
            (
                snap.path,
                snap.display_name,
                snap.source,
            ),
        )
        c.commit()
        if cursor.lastrowid is None:
            return Failure("Unexpected null ID")
        return Success(cursor.lastrowid)
    except Exception as e:
        return Failure(f"Failed to insert dataset file: {e}")


def register_file_video(c: Connection, snap: VideoSnapshot) -> Result[int, str]:
    print(f"[ Asset Manager ] Registering file (video): {snap}")
    try:
        cursor = c.execute(
            """
            INSERT INTO file_video (path, display_name)
            VALUES (?, ?)
            """,
            (
                snap.path,
                snap.display_name,
            ),
        )
        c.commit()
        if cursor.lastrowid is None:
            return Failure("Unexpected null ID")
        return Success(cursor.lastrowid)
    except Exception as e:
        return Failure(f"Failed to insert video file: {e}")


# endregion


# region Entity management
def get_all_entity_ids(c: Connection) -> List[ID]:
    cur = c.execute(
        """
        SELECT _id FROM entity
        """,
    )
    rows = cur.fetchall()
    return [row[0] for row in rows]


def new_entity(c: Connection) -> Result[ID, str]:
    print(f"[ Asset Manager ] Creating new entity...")
    cur = c.execute(
        "INSERT INTO entity (display_name, video_id) VALUES (?, ?)",
        (None, None),
    )
    c.commit()

    if cur.lastrowid is None:
        return Failure("Unexpected null ID")

    return Success(cur.lastrowid)


def update_entity(c: Connection, snap: EntitySnapshot) -> Result[None, str]:
    print(f"[ Asset Manager ] Updating entity (id={snap._id})...")
    try:
        cur = c.execute(
            """
            UPDATE entity
            SET
                display_name = ?,
                video_id = ?,
                yt_hash = ?,
                yt_title = ?,
                yt_pub_time = ?,
                yt_duration = ?,
                yt_views = ?,
                yt_watch_time = ?,
                yt_subscribers = ?,
                yt_average_view_duration = ?,
                yt_impressions = ?,
                yt_impressions_click_through_rate = ?
            WHERE _id = ?
            """,
            (
                snap.display_name,
                snap.video_id,
                snap.yt_hash,
                snap.yt_title,
                snap.yt_pub_time,
                snap.yt_duration,
                snap.yt_views,
                snap.yt_watch_time,
                snap.yt_subscribers,
                snap.yt_average_view_duration,
                snap.yt_impressions,
                snap.yt_impressions_click_through_rate,
                snap._id,
            ),
        )
        c.commit()
        return Success(None)
    except Exception as e:
        return Failure(f"Failed to update entity (id={snap._id}): {e}")


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


def upsert_link_entity_data(
    c: Connection, entity_id: ID, dataset_id: ID, label: DatasetFileLabel
) -> Result[None, str]:
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
    return Success(None)


def delete_link_entity_data(c: Connection, entity_id: ID, label: DatasetFileLabel):
    print(
        f"[ Asset Manager ] Deleting entity-data link (entity_id={entity_id}, label={label})."
    )

    c.execute(
        """
        DELETE FROM link_entity_dataset 
        WHERE entity_id = ? AND label = ?
        """,
        (entity_id, label),
    )
    c.commit()


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


def find_entities(
    c: Connection, *, count: int = -1
) -> Result[List[EntitySnapshot], str]:
    cursor = c.execute(
        """
        SELECT *
        FROM entity
        LIMIT ?
        """,
        (count,),
    )

    rows = cursor.fetchall()

    try:
        snapshots = [EntitySnapshot.from_row(r) for r in rows]
        return Success(snapshots)
    except Exception as e:
        return Failure(str(e))


def find_datasets(
    c: Connection, *, count: int = -1
) -> Result[List[DatasetSnapshot], str]:
    cursor = c.execute(
        """
        SELECT *
        FROM file_dataset
        LIMIT ?
        """,
        (count,),
    )

    rows = cursor.fetchall()

    try:
        snapshots = [DatasetSnapshot.from_row(r) for r in rows]
        return Success(snapshots)
    except Exception as e:
        return Failure(str(e))


def find_videos(c: Connection, *, count: int = -1) -> Result[List[VideoSnapshot], str]:
    cursor = c.execute(
        """
        SELECT *
        FROM file_video
        LIMIT ?
        """,
        (count,),
    )

    rows = cursor.fetchall()

    try:
        snapshots = [VideoSnapshot.from_row(r) for r in rows]
        return Success(snapshots)
    except Exception as e:
        return Failure(str(e))


def delete_entity(c: Connection, entity_id: ID) -> Result[None, str]:
    print(f"[ Asset Manager ] Deleting entity(id={entity_id}).")

    try:
        c.execute(
            """
            DELETE FROM entity 
            WHERE _id = ?
            """,
            (str(entity_id),),
        )
        c.commit()
        return Success(None)
    except Exception as e:
        return Failure(f"[ Asset Manager ] Failed to delete entity: {e}")
