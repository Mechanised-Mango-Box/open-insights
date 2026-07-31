from asset_manager.file_utils import parse_csv_to_dict
from asset_manager.db import EntitySnapshot
from utils import *
from typing import List, Dict, Any
from dataclasses import dataclass
from sqlite3 import Connection


@dataclass
class TrainingResourcesManifest:
    """
    A manifest of the resources used in training.
    """

    entity_ids: List[ID]
    dataset_file_labels: List[DatasetFileLabel]


@dataclass
class TrainingResourcesSnapshot:
    entity_snapshots: List[EntitySnapshot]
    data: Dict[DatasetFileLabel, Any]
    log: List[str]
    fetch_success: bool = False


def fetch_snapshot(c: Connection, m: TrainingResourcesManifest) -> TrainingResourcesSnapshot:
    snapshot = TrainingResourcesSnapshot(
        entity_snapshots=[],
        data={label: {} for label in m.dataset_file_labels},
        log=[],
        fetch_success=False,
    )
    has_failed: bool = False

    if not m.entity_ids:
        snapshot.log.append("[ ERR ] No entities specified. Fatal operation.")
        has_failed = True
        return snapshot

    if not m.dataset_file_labels:
        snapshot.log.append(" [ WRN ] No labels specified. Proceeding regardless.")

    # > Entity data
    for entity_id in m.entity_ids:
        match fetch_entity_snapshot(c, entity_id):
            case Success(value):
                snapshot.entity_snapshots.append(value)
            case Failure(err):
                snapshot.log.append(f" [ ERR ] Entity id provided ({entity_id}) did not match a record.")
                has_failed = True
                continue


    # > Datasets
    for label in m.dataset_file_labels:
        for entity_id in m.entity_ids:
            match fetch_dataset_path(c, entity_id, label):
                case Success(value):
                    path: Path = value
                    snapshot.data[label][entity_id] = parse_csv_to_dict(path, delimiter=",")
                case Failure(err):
                    snapshot.log.append(f" [ ERR ] File no longer exists ({entity_id}'s {label}): {err}")
                    has_failed = True
                    continue

    snapshot.fetch_success = not has_failed
    return snapshot


def fetch_entity_snapshot(c: Connection, entity_id: ID) -> Result[EntitySnapshot, str]:
    row = c.execute(
        """
        SELECT
            _id,
            display_name,
            video_id,
            yt_hash,
            yt_title,
            yt_pub_time,
            yt_duration,
            yt_views,
            yt_watch_time,
            yt_subscribers,
            yt_average_view_duration,
            yt_impressions,
            yt_impressions_click_through_rate
        FROM entity
        WHERE _id = ?
        """,
        (entity_id,),
    ).fetchone()

    if row is None:
        return Failure(f"Failed load entity (id={entity_id})")

    return Success(
        EntitySnapshot(
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
    )


def fetch_dataset_path(
    c: Connection,
    entity_id: ID,
    label: str,
) -> Result[Path, str]:
    """
    Get dataset path for this entity + label
    """
    cursor = c.execute(
        """
        SELECT fd.path
        FROM link_entity_dataset led
        JOIN file_dataset fd ON fd._id = led.dataset_id
        WHERE led.entity_id = ?
          AND led.label = ?
        LIMIT 1
        """,
        (entity_id, label),
    ).fetchone()

    if cursor is None:
        return Failure("Unexpected null cursor")

    path = cursor[0]
    if path is None:
        return Failure("No path was found")

    return Success(path)
