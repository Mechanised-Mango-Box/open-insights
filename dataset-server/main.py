import hashlib
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

import cv2
import pandas as pd
import whisper
from analysis import compute_correlations, compute_histogram, compute_loess
from flask import Flask, g, jsonify, redirect, request
from flask_cors import CORS

from utils import Failure, Result, Success

# MARK: Helpers
FileExt = Literal["mp4", "avi", "mov", "mkv", "webm"]


@dataclass
class YoutubeContentReport:
    content: str | None = None
    engaged_views: int | None = None
    average_percentage_viewed: float | None = None
    stayed_to_watch: float | None = None
    unique_viewers: int | None = None
    unique_reach: int | None = None
    average_views_per_viewer: float | None = None
    new_viewers: int | None = None
    regular_viewers: int | None = None
    casual_viewers: int | None = None
    returning_viewers: int | None = None
    views: int | None = None
    watch_time_hours: float | None = None
    subscribers: int | None = None
    average_view_duration_secs: int | None = None
    impressions: int | None = None
    impressions_click_through_rate: float | None = None


@dataclass
class YoutubeAudienceRetention:
    video_position: list[float]
    absolute_audience_retention: list[float]


@dataclass
class Transcript:
    text: str
    count_chars: int
    count_words: int


@dataclass
class SceneStats:
    duration_secs: float
    scenes: float


def allowed_file(filename: str):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# MARK: Flask
app = Flask(__name__)

# Allow angular - TBD
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "http://localhost:4200",
                "http://localhost",
                "https://mechanised-mango-box.github.io",
            ]
        }
    },
)

UPLOAD_FOLDER = "../data/local/uploads"
ALLOWED_EXTENSIONS = {"mp4", "avi", "mov", "mkv", "webm"}
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

DB_PATH = "../data/local/db.sqlite"


def _rebuild_if_pre_async_schema(
    conn: sqlite3.Connection, table: str, create_sql: str, data_columns: str
) -> None:
    """A DB created before async generation existed has its data columns
    (e.g. `text`, `duration_secs`) declared NOT NULL, which rejects a
    'processing' row that hasn't computed them yet. SQLite can't relax a
    NOT NULL constraint via ALTER TABLE, so a table missing the `status`
    column gets rebuilt from scratch, with existing rows carried over as
    status='complete'."""
    columns = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
    if "status" in columns:
        return  # freshly created with the current schema, or already migrated

    conn.execute(f"ALTER TABLE {table} RENAME TO {table}_old")
    conn.execute(create_sql)
    conn.execute(
        f"INSERT INTO {table} (file_hash, status, {data_columns}) "
        f"SELECT file_hash, 'complete', {data_columns} FROM {table}_old"
    )
    conn.execute(f"DROP TABLE {table}_old")
    conn.commit()


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS files (
            file_hash   TEXT PRIMARY KEY,
            file_ext    TEXT NOT NULL,
            uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS transcripts (
            file_hash   TEXT PRIMARY KEY REFERENCES files(file_hash),
            status      TEXT NOT NULL DEFAULT 'processing',
            text        TEXT,
            count_chars INTEGER,
            count_words INTEGER,
            error       TEXT
        );
        CREATE TABLE IF NOT EXISTS scene_stats (
            file_hash     TEXT PRIMARY KEY REFERENCES files(file_hash),
            status        TEXT NOT NULL DEFAULT 'processing',
            duration_secs REAL,
            scenes        REAL,
            error         TEXT
        );
    """)
    conn.commit()

    _rebuild_if_pre_async_schema(
        conn,
        table="transcripts",
        create_sql="""
            CREATE TABLE transcripts (
                file_hash   TEXT PRIMARY KEY REFERENCES files(file_hash),
                status      TEXT NOT NULL DEFAULT 'processing',
                text        TEXT,
                count_chars INTEGER,
                count_words INTEGER,
                error       TEXT
            )
        """,
        data_columns="text, count_chars, count_words",
    )
    _rebuild_if_pre_async_schema(
        conn,
        table="scene_stats",
        create_sql="""
            CREATE TABLE scene_stats (
                file_hash     TEXT PRIMARY KEY REFERENCES files(file_hash),
                status        TEXT NOT NULL DEFAULT 'processing',
                duration_secs REAL,
                scenes        REAL,
                error         TEXT
            )
        """,
        data_columns="duration_secs, scenes",
    )

    # Anything still 'processing' at startup belonged to a job in a previous
    # process's in-memory ThreadPoolExecutor, which doesn't survive a restart -
    # without this it would stay stuck "processing" forever.
    conn.execute(
        "UPDATE transcripts SET status = 'failed', error = 'Interrupted by server restart' "
        "WHERE status = 'processing'"
    )
    conn.execute(
        "UPDATE scene_stats SET status = 'failed', error = 'Interrupted by server restart' "
        "WHERE status = 'processing'"
    )
    conn.commit()
    conn.close()


init_db()


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def __close_db(exception: BaseException | None = None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


@app.get("/")
def __reroute_to_status():
    return redirect("/status")


@app.get("/status")
def __route_status():
    return "OK"


@app.get("/api/videos/<file_hash>")
def __route_get_video(file_hash: str):
    file_ext = get_file_ext(file_hash)
    if file_ext is None:
        return jsonify({"err": f"No uploaded video found for file hash '{file_hash}'."}), 404

    return jsonify({"file_hash": file_hash, "file_ext": file_ext})


@app.get("/api/videos/<file_hash>/transcript")
def __route_get_transcript(file_hash: str):
    file_ext = get_file_ext(file_hash)
    if file_ext is None:
        return jsonify({"err": f"No uploaded video found for file hash '{file_hash}'."}), 404

    row = get_transcript_row(file_hash)
    if row is None:
        if start_transcript_job(file_hash):
            file_path = Path(UPLOAD_FOLDER) / f"{file_hash}.{file_ext}"
            _executor.submit(_run_transcript_job, file_hash, file_path)
        return jsonify({"status": "processing"}), 200

    if row["status"] == "complete":
        return jsonify(
            {
                "status": "complete",
                "text": row["text"],
                "count_chars": row["count_chars"],
                "count_words": row["count_words"],
            }
        ), 200
    if row["status"] == "failed":
        return jsonify({"status": "failed", "error": row["error"]}), 200
    return jsonify({"status": "processing"}), 200


@app.get("/api/videos/<file_hash>/scene_stats")
def __route_get_scene_stats(file_hash: str):
    file_ext = get_file_ext(file_hash)
    if file_ext is None:
        return jsonify({"err": f"No uploaded video found for file hash '{file_hash}'."}), 404

    row = get_scene_stats_row(file_hash)
    if row is None:
        if start_scene_stats_job(file_hash):
            file_path = Path(UPLOAD_FOLDER) / f"{file_hash}.{file_ext}"
            _executor.submit(_run_scene_stats_job, file_hash, file_path)
        return jsonify({"status": "processing"}), 200

    if row["status"] == "complete":
        return jsonify(
            {
                "status": "complete",
                "duration_secs": row["duration_secs"],
                "scenes": row["scenes"],
            }
        ), 200
    if row["status"] == "failed":
        return jsonify({"status": "failed", "error": row["error"]}), 200
    return jsonify({"status": "processing"}), 200


@app.post("/api/videos")
def __route_create_video():
    # > Has file
    if "file" not in request.files:
        return jsonify({"err": "No file part in the request"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"err": "No video selected"}), 400

    # > Check file extention
    if not file.filename or not allowed_file(file.filename):
        return jsonify({"err": "Invalid file type"}), 400
    _, file_ext = os.path.splitext(file.filename)
    # something.eXt -> ext; allowed_file() above already guarantees this is one of ALLOWED_EXTENSIONS
    file_ext = cast(FileExt, file_ext.lstrip(".").lower())
    # > Get hash (chunks at a time to reduce blocking load)
    sha256_hash = hashlib.sha256()
    for chunk in iter(lambda: file.stream.read(4096), b""):
        sha256_hash.update(chunk)
    file.stream.seek(
        0
    )  # Reset the file pointer back to the start so you can save it later

    file_hash = sha256_hash.hexdigest().lower()
    file_name = f"{file_hash}.{file_ext}"

    file_path = os.path.join(app.config["UPLOAD_FOLDER"], file_name)
    headers = {"Location": f"/api/videos/{file_hash}"}
    if os.path.exists(file_path):
        insert_file(file_hash, file_ext)
        return jsonify({"file_hash": file_hash, "filename": file_name}), 200, headers

    file.save(file_path)
    insert_file(file_hash, file_ext)
    return jsonify({"file_hash": file_hash, "filename": file_name}), 201, headers


ANALYSIS_FEATURE_COLUMNS = ["duration_mins", "wpm", "scene_change_rate", "word_count"]
ANALYSIS_TARGET_COLUMN = "average_percentage_viewed"


@app.post("/api/analysis")
def __route_analysis():
    rows = request.get_json(silent=True)
    if not isinstance(rows, list) or len(rows) < 2:
        return jsonify(
            {"err": "Request body must be a JSON array of at least 2 feature rows."}
        ), 400

    required = [*ANALYSIS_FEATURE_COLUMNS, ANALYSIS_TARGET_COLUMN]
    for i, row in enumerate(rows):
        missing = [key for key in required if not isinstance(row, dict) or key not in row]
        if missing:
            return jsonify({"err": f"Row {i} is missing required field(s): {', '.join(missing)}"}), 400

    df = pd.DataFrame(rows)

    histograms = {}
    for feature in ANALYSIS_FEATURE_COLUMNS:
        bins, counts = compute_histogram(df[feature].to_numpy())
        histograms[feature] = {"bins": bins, "counts": counts}

    correlations = compute_correlations(df, ANALYSIS_FEATURE_COLUMNS, ANALYSIS_TARGET_COLUMN)

    loess = {}
    for feature in ANALYSIS_FEATURE_COLUMNS:
        x_smooth, y_smooth = compute_loess(
            df[feature].to_numpy(), df[ANALYSIS_TARGET_COLUMN].to_numpy()
        )
        loess[feature] = {"x": x_smooth.tolist(), "y": y_smooth.tolist()}

    return jsonify({"histograms": histograms, "correlations": correlations, "loess": loess})


# MARK: Operations


def insert_file(file_hash: str, file_ext: FileExt) -> None:
    db = get_db()
    db.execute(
        "INSERT OR IGNORE INTO files (file_hash, file_ext) VALUES (?, ?)",
        (file_hash, file_ext),
    )
    db.commit()


def get_file_ext(file_hash: str) -> str | None:
    db = get_db()
    row = db.execute(
        "SELECT file_ext FROM files WHERE file_hash = ?", (file_hash,)
    ).fetchone()
    return row["file_ext"] if row is not None else None


# Dataset status rows are read/written from both request threads (via Flask's
# request-scoped get_db()/g) and background executor threads, which have no
# Flask app context. Rather than special-case which thread is calling, every
# function below opens and closes its own short-lived connection.
def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_transcript_row(file_hash: str) -> sqlite3.Row | None:
    conn = _connect()
    try:
        return conn.execute(
            "SELECT status, text, count_chars, count_words, error FROM transcripts WHERE file_hash = ?",
            (file_hash,),
        ).fetchone()
    finally:
        conn.close()


def start_transcript_job(file_hash: str) -> bool:
    """Claims the transcript job for file_hash. Returns True iff this call
    claimed it (i.e. no other request already started or finished one)."""
    conn = _connect()
    try:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO transcripts (file_hash, status) VALUES (?, 'processing')",
            (file_hash,),
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def complete_transcript(file_hash: str, transcript: Transcript) -> None:
    conn = _connect()
    try:
        conn.execute(
            """
            UPDATE transcripts
            SET status = 'complete', text = ?, count_chars = ?, count_words = ?, error = NULL
            WHERE file_hash = ?
            """,
            (transcript.text, transcript.count_chars, transcript.count_words, file_hash),
        )
        conn.commit()
    finally:
        conn.close()


def fail_transcript(file_hash: str, error: str) -> None:
    conn = _connect()
    try:
        conn.execute(
            "UPDATE transcripts SET status = 'failed', error = ? WHERE file_hash = ?",
            (error, file_hash),
        )
        conn.commit()
    finally:
        conn.close()


def get_scene_stats_row(file_hash: str) -> sqlite3.Row | None:
    conn = _connect()
    try:
        return conn.execute(
            "SELECT status, duration_secs, scenes, error FROM scene_stats WHERE file_hash = ?",
            (file_hash,),
        ).fetchone()
    finally:
        conn.close()


def start_scene_stats_job(file_hash: str) -> bool:
    """Claims the scene_stats job for file_hash. Returns True iff this call
    claimed it (i.e. no other request already started or finished one)."""
    conn = _connect()
    try:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO scene_stats (file_hash, status) VALUES (?, 'processing')",
            (file_hash,),
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def complete_scene_stats(file_hash: str, scene_stats: SceneStats) -> None:
    conn = _connect()
    try:
        conn.execute(
            """
            UPDATE scene_stats
            SET status = 'complete', duration_secs = ?, scenes = ?, error = NULL
            WHERE file_hash = ?
            """,
            (scene_stats.duration_secs, scene_stats.scenes, file_hash),
        )
        conn.commit()
    finally:
        conn.close()


def fail_scene_stats(file_hash: str, error: str) -> None:
    conn = _connect()
    try:
        conn.execute(
            "UPDATE scene_stats SET status = 'failed', error = ? WHERE file_hash = ?",
            (error, file_hash),
        )
        conn.commit()
    finally:
        conn.close()


# MARK: Calculations

# Ported from video_analysis/whisper_functions.py. Loaded eagerly at import time,
# same as the original — every server start pays the model load cost upfront.
_whisper_model = whisper.load_model("turbo")

# Runs transcript/scene_stats generation off the request thread so a GET can
# return its "processing" status immediately instead of blocking for the
# duration of the calculation. Whisper and OpenCV do their heavy work in
# native/PyTorch code that releases the GIL, so a thread pool (rather than
# multiprocessing) is sufficient to get real concurrency here.
_executor = ThreadPoolExecutor(max_workers=2)


def calculate_transcript(file_path: Path) -> Transcript:
    result = _whisper_model.transcribe(str(file_path))
    text: str = result["text"]
    return Transcript(
        text=text,
        count_chars=len(text),
        count_words=len(text.split()),
    )


def _run_transcript_job(file_hash: str, file_path: Path) -> None:
    try:
        transcript = calculate_transcript(file_path)
    except Exception as e:
        fail_transcript(file_hash, str(e))
        return
    complete_transcript(file_hash, transcript)


# Ported from gui/feature_extraction.py (video_duration_mins, count_scene_transitions),
# orchestrated the same way gui/tab_scenes_stats.py does. NOT based on
# video_analysis/open_cv_functions.py, which opens its VideoCapture at module scope
# against an undefined variable and crashes on import.
def video_duration_mins(video_capture: cv2.VideoCapture) -> Result[float, str]:
    if not video_capture.isOpened():
        return Failure(f"Failed to open video file: {video_capture}")

    fps = video_capture.get(cv2.CAP_PROP_FPS)
    total_frames = video_capture.get(cv2.CAP_PROP_FRAME_COUNT)

    duration = (total_frames / fps) / 60  # in mins
    return Success(duration)


def count_scene_transitions(
    video_capture: cv2.VideoCapture, threshold: float = 30.0
) -> Result[int, str]:
    if not video_capture.isOpened():
        return Failure(f"Failed to open video file: {video_capture}")

    transition_count = 0
    previous_frame = None

    while True:
        success, frame = video_capture.read()
        if not success:
            break

        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if previous_frame is not None:
            difference = cv2.absdiff(previous_frame, gray_frame)
            mean_difference = difference.mean()
            if mean_difference > threshold:
                transition_count += 1

        previous_frame = gray_frame

    return Success(transition_count)


def calculate_scene_stats(file_path: Path) -> SceneStats:
    video_capture = cv2.VideoCapture(str(file_path))
    try:
        match (video_duration_mins(video_capture), count_scene_transitions(video_capture)):
            case (Success(duration_mins), Success(transition_count)):
                return SceneStats(
                    duration_secs=duration_mins * 60,
                    scenes=float(transition_count),
                )
            case errs:
                raise RuntimeError(f"Scene stats calculation failed: {errs}")
    finally:
        video_capture.release()


def _run_scene_stats_job(file_hash: str, file_path: Path) -> None:
    try:
        scene_stats = calculate_scene_stats(file_path)
    except Exception as e:
        fail_scene_stats(file_hash, str(e))
        return
    complete_scene_stats(file_hash, scene_stats)


# MARK: Main
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, threaded=True)
