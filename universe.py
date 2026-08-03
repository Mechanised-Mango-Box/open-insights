from asset_manager.db import find_datasets
from utils import DatasetSnapshot
from utils import EntitySnapshot
from utils import Success
from utils import Failure
from asset_manager.db import find_entities
from typing import List
from sqlite3 import Connection


class Universe:
    db: Connection

    entity_snapshots: List[EntitySnapshot] = []
    dataset_snapshots: List[DatasetSnapshot] = []

    def reload_entity_snapshots(self):
        match find_entities(self.db):
            case Failure(err):
                print(err)
            case Success(snaps):
                self.entity_snapshots.clear()
                self.entity_snapshots.extend(snaps)

    def reload_dataset_snapshots(self):
        match find_datasets(self.db):
            case Failure(err):
                print(err)
            case Success(snaps):
                self.dataset_snapshots.clear()
                self.dataset_snapshots.extend(snaps)