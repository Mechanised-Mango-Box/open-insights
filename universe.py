from utils import ID
from typing_extensions import Dict
from utils import Video
# from typing_extensions import Set
# from typing_extensions import Optional
# from asset_manager.db import find_videos
# from asset_manager.db import find_datasets
# from utils import VideoSnapshot, DatasetSnapshot, EntitySnapshot
from utils import Success
from utils import Failure
# from asset_manager.db import find_entities
from typing import List
from sqlite3 import Connection


class Universe:
    db: Connection
    whisper_model: Whisper

    entities: List[Video] = []
    # et: EntityTable = EntityTable()

    # entity_snapshots: List[EntitySnapshot] = []
    # dataset_snapshots: List[DatasetSnapshot] = []
    # video_snapshots: List[VideoSnapshot] = []

    # def reload_entity_snapshots(self):
    #     match find_entities(self.db):
    #         case Failure(err):
    #             print(f"[ ERR ] {err}")
    #         case Success(snaps):
    #             self.entity_snapshots.clear()
    #             self.entity_snapshots.extend(snaps)

    # def reload_dataset_snapshots(self):
    #     match find_datasets(self.db):
    #         case Failure(err):
    #             print(f"[ ERR ] {err}")
    #         case Success(snaps):
    #             self.dataset_snapshots.clear()
    #             self.dataset_snapshots.extend(snaps)

    # def reload_video_snapshots(self):
    #     match find_videos(self.db):
    #         case Failure(err):
    #             print(f"[ ERR ] {err}")
    #         case Success(snaps):
    #             self.video_snapshots.clear()
    #             self.video_snapshots.extend(snaps)
