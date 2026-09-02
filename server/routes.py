import hashlib
import os
from pathlib import Path
from typing import cast

import pandas as pd
from analysis import compute_correlations, compute_histogram, compute_loess
from config import UPLOAD_FOLDER, allowed_file
from db import (
    get_file_ext,
    get_scene_stats_row,
    get_transcript_row,
    insert_file,
    retry_scene_stats_job,
    retry_transcript_job,
    start_scene_stats_job,
    start_transcript_job,
)
from flask import Blueprint, jsonify, redirect, request
from models import FileExt
from processing import submit_scene_stats_job, submit_transcript_job

bp = Blueprint("api", __name__)


@bp.get("/")
def __reroute_to_status():
    return redirect("/status")


@bp.get("/status")
def __route_status():
    return "OK"


@bp.get("/api/videos/<file_hash>")
def __route_get_video(file_hash: str):
    file_ext = get_file_ext(file_hash)
    if file_ext is None:
        return jsonify({"err": f"No uploaded video found for file hash '{file_hash}'."}), 404

    return jsonify({"file_hash": file_hash, "file_ext": file_ext})


@bp.get("/api/videos/<file_hash>/transcript")
def __route_get_transcript(file_hash: str):
    file_ext = get_file_ext(file_hash)
    if file_ext is None:
        return jsonify({"err": f"No uploaded video found for file hash '{file_hash}'."}), 404
    file_path = Path(UPLOAD_FOLDER) / f"{file_hash}.{file_ext}"

    row = get_transcript_row(file_hash)
    if row is None:
        if "peek" in request.args:
            return jsonify({"status": "not_started"}), 200
        if start_transcript_job(file_hash):
            submit_transcript_job(file_hash, file_path)
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
        if "retry" in request.args:
            if retry_transcript_job(file_hash):
                submit_transcript_job(file_hash, file_path)
            return jsonify({"status": "processing"}), 200
        return jsonify({"status": "failed", "error": row["error"]}), 200
    return jsonify({"status": "processing"}), 200


@bp.get("/api/videos/<file_hash>/scene_stats")
def __route_get_scene_stats(file_hash: str):
    file_ext = get_file_ext(file_hash)
    if file_ext is None:
        return jsonify({"err": f"No uploaded video found for file hash '{file_hash}'."}), 404
    file_path = Path(UPLOAD_FOLDER) / f"{file_hash}.{file_ext}"

    row = get_scene_stats_row(file_hash)
    if row is None:
        if "peek" in request.args:
            return jsonify({"status": "not_started"}), 200
        if start_scene_stats_job(file_hash):
            submit_scene_stats_job(file_hash, file_path)
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
        if "retry" in request.args:
            if retry_scene_stats_job(file_hash):
                submit_scene_stats_job(file_hash, file_path)
            return jsonify({"status": "processing"}), 200
        return jsonify({"status": "failed", "error": row["error"]}), 200
    return jsonify({"status": "processing"}), 200


@bp.post("/api/videos")
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

    file_path = os.path.join(UPLOAD_FOLDER, file_name)
    headers = {"Location": f"/api/videos/{file_hash}"}
    if os.path.exists(file_path):
        insert_file(file_hash, file_ext)
        return jsonify({"file_hash": file_hash, "filename": file_name}), 200, headers

    file.save(file_path)
    insert_file(file_hash, file_ext)
    return jsonify({"file_hash": file_hash, "filename": file_name}), 201, headers


ANALYSIS_FEATURE_COLUMNS = ["duration_mins", "wpm", "scene_change_rate", "word_count"]
ANALYSIS_TARGET_COLUMN = "average_percentage_viewed"


@bp.post("/api/analysis")
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
