from typing_extensions import Set
from utils import VideoSnapshot
import pathlib
from utils import DatasetSnapshot
from asset_manager.db import register_file_video
from gui.tables import video_table
from gui.tables import dataset_table
from imgui_bundle import imgui_md
from imgui_bundle import portable_file_dialogs as pfd
from imgui_bundle import imgui
from universe import Universe
from universe import Universe
from imgui_bundle import imgui
from typing import Optional, List
from sqlite3 import Connection
from asset_manager.db import (
    register_file_dataset,
)
from asset_manager.training_resources import fetch_snapshot, TrainingResourcesManifest
from utils import Failure, Success
from utils import ID

foo: Set[ID] = set()

def build_page(u: Universe):
    global foo
    if imgui.begin_tab_item("Datasets")[0]:
        imgui_md.render(
            """
## Datasets
This is a list of all datasets.
        """
        )
        if imgui.button("Add dataset(s)"):
            selection = pfd.open_file(
                "Select datasets...",
                ".",
                ["Dataset Files", "*.csv *.json"],
                options=pfd.opt.multiselect,
            ).result()
            print(selection)
            for dataset_path in selection:
                snap = DatasetSnapshot(
                    -1, dataset_path, pathlib.Path(dataset_path).stem, None
                )
                match register_file_dataset(u.db, snap):
                    case Failure(err):
                        print(err)
                        break
            u.reload_dataset_snapshots()
            print(u.dataset_snapshots)
        dataset_table(u, "dataset_table")
        imgui.end_tab_item()

    if imgui.begin_tab_item("Video Files")[0]:
        imgui_md.render(
            """
## Video Files
This is a list of all video files. This does not include data about said files (see: "Entity")
        """
        )
        if imgui.button("Add video(s)"):
            selection = pfd.open_file(
                "Select videos...",
                ".",
                ["Video Files", "*.mp4 *.mkv", "*.*"],
                options=pfd.opt.multiselect,
            ).result()
            print(selection)
            for video_path in selection:
                snap = VideoSnapshot(
                    -1, video_path, pathlib.Path(video_path).stem
                )
                match register_file_video(u.db, snap):
                    case Failure(err):
                        print(err)
                        break
            u.reload_video_snapshots()

        video_table("video_table", u.video_snapshots, foo, True)
        imgui.end_tab_item()


# def __placeholder_register_files(c: Connection, paths: List[str]):
#     ids_to_train: List[ID] = []

#     for path in paths:
#         dataset_id: Optional[ID] = None
#         match find_file_dataset(c, path):
#             case Success(ds_id):
#                 print(f"File at {path} already exists with id={ds_id}")
#                 dataset_id = ds_id

#             case Failure():
#                 match register_file_dataset(c, path):
#                     case Success(ds_id):
#                         dataset_id = ds_id
#                     case Failure(err):
#                         print(f"Failed to register file: {err}")
#                         continue
#         assert dataset_id is not None

#         entity_id: Optional[ID] = None
#         match find_entities_using_dataset(c, dataset_id):
#             case []:
#                 while True:
#                     yt_title: str = input("What is the title of the yt video to attach to? ")
#                     matching_entities = find_entity_ids_from_yt_title(c, yt_title)
#                     if len(matching_entities) > 0:
#                         break
#                     else:
#                         print("Invalid title")
#                 entity_id = matching_entities[0]
#                 upsert_link_entity_data(c, entity_id, dataset_id, "yt_audience_retention")

#             case [*entities]:
#                 print(f"Entity already linked to video/s: {entities}. Selecting one.")
#                 entity_id = entities[0]

#         assert entity_id is not None
#         ids_to_train.append(entity_id)

#     print(f"creating manifest with entity ids: {ids_to_train}")
#     m: TrainingResourcesManifest = TrainingResourcesManifest(
#         entity_ids=ids_to_train,
#         dataset_file_labels=["yt_audience_retention"],
#     )
#     print(fetch_snapshot(c, m))
