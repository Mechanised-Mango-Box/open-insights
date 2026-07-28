from asset_manager import Path
from sqlite3 import Connection
import csv
from dataclasses import dataclass

def yt_content_bulk_upsert(c: Connection, path: Path):
    cursor = c.cursor()
    
    # take a bulk report (content - data table) and upsert entities
    with open(path, mode="r", encoding="utf-8") as file:
        reader = csv.DictReader(file)

        for row in reader:
            yt_hash = row["Content"]
            if yt_hash == "Total" or len(yt_hash) == 0:
                #? Skip a row without a hash
                #? Skip the totals row if it exists
                continue

            cursor.execute("SELECT _id FROM entity WHERE yt_hash = ?", (yt_hash,))
            existing = cursor.fetchone() # TODO update multiple if needed
            
            if existing:
                entity_id = existing["_id"]
                cursor.execute(
                    """
                    UPDATE entity
                    SET
                        yt_title = ?,
                        yt_pub_time = ?,
                        yt_duration = ?,
                        yt_views = ?,
                        yt_watch_time = ?,
                        yt_subscribers = ?,
                        yt_average_view_duration = ?,
                        yt_impressions = ?,
                        yt_impressions_click_through_rate = ? 
                    WHERE 
                        _id = ? AND yt_hash = ?
                    """,
                    (
                        row["Video title"],
                        row["Video publish time"],
                        row["Duration"],
                        row["Views"],
                        row["Watch time (hours)"],
                        row["Subscribers"],
                        row["Average view duration"],
                        row["Impressions"],
                        row["Impressions click-through rate (%)"],
                        entity_id,
                        yt_hash,
                    ),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO entity (
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
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        yt_hash,
                        row["Video title"],
                        row["Video publish time"],
                        row["Duration"],
                        row["Views"],
                        row["Watch time (hours)"],
                        row["Subscribers"],
                        row["Average view duration"],
                        row["Impressions"],
                        row["Impressions click-through rate (%)"],
                    ),
                )

        c.commit()