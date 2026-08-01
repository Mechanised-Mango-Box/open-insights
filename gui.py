from asset_manager.db import find_entities
from sqlite3 import Connection
from asset_manager.training_resources import fetch_snapshot
from asset_manager.training_resources import TrainingResourcesManifest
from asset_manager.db import upsert_link_entity_data
from asset_manager.db import find_entity_ids_from_yt_title
from asset_manager.db import find_entities_using_dataset
from asset_manager.db import register_file_dataset
from utils import Failure
from utils import Success
from asset_manager.db import find_file_dataset
from typing import Optional
from utils import ID
from typing import List
import dearpygui.dearpygui as dpg
from asset_manager.db import EntitySnapshot  # (used for type hints only)

TABLE_TAG = "entity_snapshot_table"


def clear_table(table_tag: str):
    # Easiest reliable approach: delete all existing rows (keep columns).
    # Depending on your DPG build, you may need to delete only children.
    dpg.delete_item(table_tag, children_only=True)


def populate_table_from_db(c: Connection, table_tag: str = TABLE_TAG):
    match find_entities(c):
        case Failure(err):
            print(err)
            return
        case Success(snapshots):
            # delete all existing rows
            # dpg.delete_item(table_tag, children_only=True)
            for s in snapshots:
                row_tag = str(s._id)

                dpg.add_table_row(parent=table_tag, tag=row_tag)

                dpg.add_text(str(s._id), parent=row_tag)
                dpg.add_text(s.display_name, parent=row_tag)
                dpg.add_text(str(s.video_id), parent=row_tag)
                dpg.add_text(s.yt_hash, parent=row_tag)
                dpg.add_text(s.yt_title, parent=row_tag)
                dpg.add_text(s.yt_pub_time, parent=row_tag)
                dpg.add_text(str(s.yt_duration), parent=row_tag)
                dpg.add_text(str(s.yt_views), parent=row_tag)
                dpg.add_text(str(s.yt_watch_time), parent=row_tag)
                dpg.add_text(str(s.yt_subscribers), parent=row_tag)
                dpg.add_text(str(s.yt_average_view_duration), parent=row_tag)
                dpg.add_text(str(s.yt_impressions), parent=row_tag)
                dpg.add_text(str(s.yt_impressions_click_through_rate), parent=row_tag)


def build_entity_snapshot_table():
    with dpg.table(
        tag=TABLE_TAG,
        header_row=True,
        borders_outerH=True,
        borders_outerV=True,
        borders_innerH=True,
        borders_innerV=True,
        resizable=True,
    ):
        dpg.add_table_column(label="_id")
        dpg.add_table_column(label="display_name")
        dpg.add_table_column(label="video_id")
        dpg.add_table_column(label="yt_hash")
        dpg.add_table_column(label="yt_title")
        dpg.add_table_column(label="yt_pub_time")
        dpg.add_table_column(label="yt_duration")
        dpg.add_table_column(label="yt_views")
        dpg.add_table_column(label="yt_watch_time")
        dpg.add_table_column(label="yt_subscribers")
        dpg.add_table_column(label="yt_average_view_duration")
        dpg.add_table_column(label="yt_impressions")
        dpg.add_table_column(label="yt_impressions_click_through_rate")

def register_files(c: Connection, paths: List[str]):
    ids_to_train: List[ID] = []

    for path in paths:
        dataset_id: Optional[ID] = None
        match find_file_dataset(c, path):
            case Success(ds_id):
                print(f"File at {path} already exists with id={ds_id}")
                dataset_id = ds_id

            case Failure():
                match register_file_dataset(c, path):
                    case Success(ds_id):
                        dataset_id = ds_id
                    case Failure(err):
                        print(f"Failed to register file: {err}")
                        continue
        assert dataset_id is not None

        entity_id: Optional[ID] = None
        match find_entities_using_dataset(c, dataset_id):
            case []:
                while True:
                    yt_title: str = input("What is the title of the yt video to attach to? ")
                    matching_entities = find_entity_ids_from_yt_title(c, yt_title)
                    if len(matching_entities) > 0:
                        break
                    else:
                        print("Invalid title")
                entity_id = matching_entities[0]
                upsert_link_entity_data(c, entity_id, dataset_id, "yt_audience_retention")
            case [*entities]:
                print(f"Entity already linked to video/s: {entities}. Selecting one.")
                entity_id = entities[0]

        assert entity_id is not None
        ids_to_train.append(entity_id)

    print(f"creating manifest with entity ids: {ids_to_train}")
    m: TrainingResourcesManifest = TrainingResourcesManifest(entity_ids=ids_to_train, dataset_file_labels=["yt_audience_retention"])
    print(fetch_snapshot(c, m))


def build_ui(c: Connection):
    with dpg.window(label="Open Insights", tag="main_window", width=1050, height=580):
        dpg.add_text("Entity Snapshots")
        build_entity_snapshot_table()
        populate_table_from_db(c, TABLE_TAG)
