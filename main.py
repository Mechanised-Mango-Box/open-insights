from typing import Optional
from asset_manager.db import find_entities_using_dataset
from asset_manager.db import find_file_dataset
import sys
from PySide6.QtWidgets import QApplication
from asset_manager.yt import *
from asset_manager.db import *
from asset_manager.training_resources import TrainingResourcesManifest, fetch_snapshot
from sqlite3 import Connection


MOCK_DATA_PATH: str = "./data/sample/mock-yt-fake-lecture-series/"
DB_CONN: Connection

import sys
from PySide6.QtWidgets import QApplication, QWidget, QVBoxLayout, QPushButton, QLabel, QFileDialog, QMessageBox


class FileUploadWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("File Upload (Local)")
        self.resize(520, 200)

        self.label = QLabel("No file selected.")
        self.label.setWordWrap(True)

        self.btn = QPushButton("Choose File…")
        self.btn.clicked.connect(self.choose_file)

        layout = QVBoxLayout()
        layout.addWidget(self.label)
        layout.addWidget(self.btn)
        self.setLayout(layout)

    def choose_file(self):
        files, _ = QFileDialog.getOpenFileNames(None, "Select files", "", "All Files (*.*)")

        if files:
            print("files:", files)

        self.label.setText(f"Selected:\n{files}")
        foo(files)


def foo(paths: List[str]):
    ids_to_train: List[ID] = []

    for path in paths:
        dataset_id: Optional[ID] = None
        match find_file_dataset(DB_CONN, path):
            case Success(ds_id):
                print(f"File at {path} already exists with id={ds_id}")
                dataset_id = ds_id

            case Failure():
                match register_file_dataset(DB_CONN, path):
                    case Success(ds_id):
                        dataset_id = ds_id
                    case Failure(err):
                        print(f"Failed to register file: {err}")
                        continue
        assert dataset_id is not None

        entity_id: Optional[ID] = None
        match find_entities_using_dataset(DB_CONN, dataset_id):
            case []:
                while 1:
                    yt_title: str = input("What is the title of the yt video to attach to? ")
                    matching_entities = find_entity_ids_from_yt_title(DB_CONN, yt_title)
                    if len(matching_entities) > 0:
                        break
                    else:
                        print("Invalid title")
                entity_id = matching_entities[0]
                upsert_link_entity_data(DB_CONN, entity_id, dataset_id, "yt_audience_retention")
            case [*entities]:
                print(f"Entity already linked to video/s: {entities}. Selecting one.")
                entity_id = entities[0]

        assert entity_id is not None
        ids_to_train.append(entity_id)

    print(f"creating manifest with entity ids: {ids_to_train}")
    m: TrainingResourcesManifest = TrainingResourcesManifest(entity_ids=ids_to_train, dataset_file_labels=["yt_audience_retention"])
    print(fetch_snapshot(DB_CONN, m))


if __name__ == "__main__":
    print("Program start.")
    app = QApplication(sys.argv)

    DB_CONN = connect_db("./index.sqlite")
    setup_schema(DB_CONN)

    # # > Mockup file uploads
    # # > W1
    # file_id_w1_m = register_file_dataset(DB_CONN, MOCK_DATA_PATH + "w1/yt_metrics.csv")

    # # > W2
    # file_id_w2_v = register_file_video(DB_CONN, MOCK_DATA_PATH + "w2/vid.mp4")
    # file_id_w2_m = register_file_dataset(DB_CONN, MOCK_DATA_PATH + "w2/yt_metrics.csv")
    # file_id_w2_d = register_file_dataset(DB_CONN, MOCK_DATA_PATH + "w2/dummy.csv")

    # # > W3
    # file_id_w3_v = register_file_video(DB_CONN, MOCK_DATA_PATH + "w3/vid.mp4")
    # file_id_w3_m = register_file_dataset(DB_CONN, MOCK_DATA_PATH + "w3/yt_metrics.csv")

    # # > New entry
    # ent_w1_id = new_entity(DB_CONN)
    # print(ent_w1_id)
    # upsert_entity_data(DB_CONN, ent_w1_id, file_id_w1_m, "yt_metrics")

    # ent_w2_id = new_entity(DB_CONN)
    # print(ent_w2_id)
    # upsert_entity_video(DB_CONN, ent_w2_id, file_id_w2_v)
    # upsert_entity_data(DB_CONN, ent_w2_id, file_id_w2_d, "dummy")
    # upsert_entity_data(DB_CONN, ent_w2_id, file_id_w2_m, "yt_metrics")

    # ent_w3_id = new_entity(DB_CONN)
    # print(ent_w3_id)
    # upsert_entity_video(DB_CONN, ent_w3_id, file_id_w3_v)
    # upsert_entity_data(DB_CONN, ent_w3_id, file_id_w3_m, "yt_metrics")

    if f := yt_content_upsert_file(DB_CONN, "./data/sample/mock-v3/Content FAKE_DATE_RANGE USERNAME/Table data.csv") is Failure:
        print(f)

    w = FileUploadWindow()
    w.show()

    # paths: List[Path] = [
    #     "./data/sample/mock-v3/Audience retention DATE_RANGE How to Fix Slow PC (Step-by-Step)/All.csv",
    #     "./data/sample/mock-v3/Audience retention DATE_RANGE My Cat’s Reaction to Rain/All.csv",
    #     "./data/sample/mock-v3/Audience retention DATE_RANGE How to Read Data Like a Pro/All.csv",
    #     "./data/sample/mock-v3/Audience retention DATE_RANGE Quick Calligraphy Practice (30s)/All.csv",
    # ]

    # match register_file_dataset(DB_CONN, path):
    #     case Success(value):
    #         entity_id = find_entity_ids_from_yt_title(DB_CONN, "How to Fix Slow PC (Step-by-Step)")[0]
    #         upsert_link_entity_data(DB_CONN, entity_id, value, "yt_audience_retention")
    #         ids_to_track.append(entity_id)
    #     case Failure(error):
    #         print(error)

    print("Program exited.")
    sys.exit(app.exec())
