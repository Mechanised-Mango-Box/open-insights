from universe import Universe
from imgui_bundle import imgui
from typing import Optional, List
from sqlite3 import Connection
from asset_manager.db import find_entities, find_file_dataset, find_entities_using_dataset, register_file_dataset, find_entity_ids_from_yt_title, upsert_link_entity_data
from asset_manager.training_resources import fetch_snapshot, TrainingResourcesManifest
from utils import Failure, Success
from utils import ID
import mimetypes

def entity_table(u: Universe, element_id: str):
    table_flags = imgui.TableFlags_.borders | imgui.TableFlags_.row_bg | imgui.TableFlags_.resizable

    if imgui.begin_table(element_id, 12, table_flags):
        # > Generate Headers
        imgui.table_setup_column("Display Name")
        imgui.table_setup_column("Video File")

        imgui.table_setup_column("YouTube Hash")
        imgui.table_setup_column("YouTube Title")

        imgui.table_setup_column("Pub Time")
        imgui.table_setup_column("Duration (s)")
        imgui.table_setup_column("Views")

        imgui.table_setup_column("Watch Time (mins)")
        imgui.table_setup_column("Subscribers")
        imgui.table_setup_column("Avg View Duration (s)")

        imgui.table_setup_column("Impressions")
        imgui.table_setup_column("CTR %")
        imgui.table_headers_row()

        # > Populate
        for snap in u.entity_snapshots:
            imgui.table_next_row()
            
            imgui.table_set_column_index(0)
            clicked, _ = imgui.selectable(
                f"{snap.display_name}##{snap._id}", 
                False, imgui.SelectableFlags_.span_all_columns | imgui.SelectableFlags_.allow_overlap)
                
            imgui.table_set_column_index(1); imgui.text(str(snap.video_id))

            imgui.table_set_column_index(2); imgui.text(str(snap.yt_hash))
            imgui.table_set_column_index(3); imgui.text(str(snap.yt_title))

            imgui.table_set_column_index(4); imgui.text(str(snap.yt_pub_time))
            imgui.table_set_column_index(5); imgui.text(str(snap.yt_duration))
            imgui.table_set_column_index(6); imgui.text(str(snap.yt_views))

            imgui.table_set_column_index(7); imgui.text(str(snap.yt_watch_time * 60))
            imgui.table_set_column_index(8); imgui.text(str(snap.yt_subscribers))
            imgui.table_set_column_index(9); imgui.text(str(snap.yt_average_view_duration))

            imgui.table_set_column_index(10); imgui.text(str(snap.yt_impressions))
            imgui.table_set_column_index(11); imgui.text(str(snap.yt_impressions_click_through_rate))

        imgui.end_table()

def dataset_table(u: Universe, element_id: str):
    table_flags = imgui.TableFlags_.borders | imgui.TableFlags_.row_bg | imgui.TableFlags_.resizable

    if imgui.begin_table(element_id, 3, table_flags):
        # > Generate Headers
        imgui.table_setup_column("ID")
        imgui.table_setup_column("Path")
        imgui.table_setup_column("Type")

        imgui.table_headers_row()

        # > Populate
        for snap in u.dataset_snapshots:
            imgui.table_next_row()

            imgui.table_set_column_index(0);            imgui.text(str(snap._id))
            imgui.table_set_column_index(1);            imgui.text(str(snap.path))
            imgui.table_set_column_index(2)
            mime, _ = mimetypes.guess_type(snap.path)
            imgui.text(str(mime))

        imgui.end_table()


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
    m: TrainingResourcesManifest = TrainingResourcesManifest(
        entity_ids=ids_to_train,
        dataset_file_labels=["yt_audience_retention"],
    )
    print(fetch_snapshot(c, m))
