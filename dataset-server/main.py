import hashlib
import os
from dataclasses import dataclass
from sqlite3 import Connection
from typing import Any, Literal

from flask import Flask, jsonify, redirect, request
from flask_cors import CORS
from werkzeug.utils import secure_filename

# MARK: Helpers
FileExt = Literal["mp4", "webm"]


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
    resources={r"/api/*": {"origins": ["http://localhost:4200", "http://localhost"]}},
)

UPLOAD_FOLDER = "../data/local/uploads"
ALLOWED_EXTENSIONS = {"mp4", "avi", "mov", "mkv", "webm"}
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.get("/")
def __reroute_to_status():
    return redirect("/status")


@app.get("/status")
def __route_status():
    return "OK"


@app.get("/api/get_record")
def __route_get_record():
    if (file_hash := request.args.get("file_hash", type=str)) is None:
        return jsonify({"err": "Missing file hash."}), 400

    res: dict[str, Any] = {}
    if (request.args.get("transcript")) is not None:
        res["transcript"] = True

    if (request.args.get("scene_stats")) is not None:
        res["scene_stats"] = True

    return jsonify({"requested_file_hash": file_hash, "record": res})


@app.get("/api/has_video")
def __route_has_video():
    if (file_hash := request.args.get("file_hash", type=str)) is None:
        return jsonify({"err": "Missing file hash."}), 400

    return jsonify({"res": False})


@app.post("/api/upload_video")
def __route_upload_video():
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
    file_ext = file_ext.lstrip(".").lower()  # something.eXt -> ext
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
    if os.path.exists(file_path):
        return jsonify({"message": "Video already exists", "filename": file_name}), 200

    file.save(file_path)
    return jsonify(
        {"message": "Video uploaded successfully", "filename": file_name}
    ), 200


# MARK: Operations


def insert_file(file_hash: str, file_ext: FileExt): ...


# MARK: Main
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
