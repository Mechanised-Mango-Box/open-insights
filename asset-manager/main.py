from asset_manager import *
from training_resources import TrainingResourcesManifest, fetch_snapshot
from sqlite3 import Connection
from pathlib import Path
from uuid import uuid4
from yt import *

MOCK_DATA_PATH: str = "../data/sample/mock-yt-fake-lecture-series/"
DB_CONN: Connection


if __name__ == "__main__":
    print("Program start.")
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


    yt_content_bulk_upsert(DB_CONN, "../data/sample/mock-v3/Content FAKE_DATE_RANGE USERNAME/Table data.csv")

    file_id_1 = register_file_dataset(DB_CONN, "../data/sample/mock-v3/Audience retention DATE_RANGE How to Fix Slow PC (Step-by-Step)/All.csv")
    entity_id_1 = find_entity_ids_from_yt_title(DB_CONN, "How to Fix Slow PC (Step-by-Step)")[0]
    upsert_entity_data(DB_CONN, entity_id_1, file_id_1, "yt_aud_ret")
    
    file_id_2 = register_file_dataset(DB_CONN, "../data/sample/mock-v3/Audience retention DATE_RANGE My Cat’s Reaction to Rain/All.csv")
    entity_id_2 = find_entity_ids_from_yt_title(DB_CONN, "My Cat’s Reaction to Rain")[0]
    upsert_entity_data(DB_CONN, entity_id_2, file_id_2, "yt_aud_ret")

    file_id_3 = register_file_dataset(DB_CONN, "../data/sample/mock-v3/Audience retention DATE_RANGE How to Read Data Like a Pro/All.csv")
    entity_id_3 = find_entity_ids_from_yt_title(DB_CONN, "How to Read Data Like a Pro")[0]
    upsert_entity_data(DB_CONN, entity_id_3, file_id_3, "yt_aud_ret")

    file_id_4 = register_file_dataset(DB_CONN, "../data/sample/mock-v3/Audience retention DATE_RANGE Quick Calligraphy Practice (30s)/All.csv")
    entity_id_4 = find_entity_ids_from_yt_title(DB_CONN, "Quick Calligraphy Practice (30s)")[0]
    upsert_entity_data(DB_CONN, entity_id_4, file_id_4, "yt_aud_ret")

    m: TrainingResourcesManifest = TrainingResourcesManifest(
        entity_ids=[file_id_1, file_id_2, file_id_3, file_id_4],
        dataset_file_labels=["yt_aud_ret"]
    )
    print(fetch_snapshot(DB_CONN, m))