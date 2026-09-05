import json
import os
from pathlib import Path
from typing import cast

import pandas as pd
from analysis import compute_correlations, compute_histogram, compute_loess
from config import UPLOAD_FOLDER, allowed_file
from db import (
    KINDS,
    DatasetKind,
    dataset_state,
    enqueue,
    get_file_ext,
    insert_file,
    requeue_expired,
)
from flask import Blueprint, jsonify, make_response, redirect, request
from werkzeug.exceptions import NotFound
from models import FileExt
from processing import SUBMIT
from utils import hash_stream

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


# Both dataset kinds are served by one pair of handlers below rather than a
# copied block each. The two used to be near-identical and had already drifted -
# only the transcript one ever learned about stale results - which is exactly
# the divergence a shared implementation prevents.
def _not_found(message: str) -> NotFound:
    """A 404 carrying the same {"err": ...} body the rest of the API uses -
    werkzeug's default HTML page would break a client that only parses JSON."""
    return NotFound(response=make_response(jsonify({"err": message}), 404))


def _resolve(file_hash: str, kind_name: str) -> tuple[DatasetKind, Path]:
    """Resolves the URL's two variables, or aborts 404. Aborting rather than
    returning an error for the caller to forward keeps both handlers reading as
    the happy path, and keeps the two failures distinct: 'that dataset kind does
    not exist' and 'that video was never uploaded' send a caller to very
    different places."""
    kind = KINDS.get(kind_name)
    if kind is None:
        known = ", ".join(sorted(KINDS))
        raise _not_found(f"Unknown dataset '{kind_name}'. Known: {known}.")

    file_ext = get_file_ext(file_hash)
    if file_ext is None:
        raise _not_found(f"No uploaded video found for file hash '{file_hash}'.")
    return kind, Path(UPLOAD_FOLDER) / f"{file_hash}.{file_ext}"


def _serialized(kind: DatasetKind, file_hash: str):
    """dataset_state() speaks the storage vocabulary; the wire adds only the one
    transformation the client cannot do for itself - segments are stored as a
    JSON string and belong on the wire as an array."""
    state = dataset_state(kind, file_hash)
    if state["state"] == "ready" and "segments_json" in state:
        state["segments"] = json.loads(state.pop("segments_json"))
    return state


@bp.get("/api/videos/<file_hash>/<kind_name>")
def __route_get_dataset(file_hash: str, kind_name: str):
    """Read-only. Never enqueues, never mutates - which is what makes the
    client's background re-poll of every visible row safe by construction
    rather than by remembering to pass ?peek. Use POST to start work."""
    kind, _ = _resolve(file_hash, kind_name)

    # Reclaiming a job whose worker died is a repair of state that is already
    # wrong, not a side effect of the read: without it a lost job would report
    # 'running' forever and the caller would poll to its timeout.
    requeue_expired()
    return jsonify(_serialized(kind, file_hash)), 200


@bp.post("/api/videos/<file_hash>/<kind_name>")
def __route_start_dataset(file_hash: str, kind_name: str):
    """Starts generation, or retries a failed job. Idempotent: posting to
    something already queued or running changes nothing and reports the current
    state, so a double-click cannot start two workers.

    ?force=true retries a job that has exhausted MAX_ATTEMPTS - the deliberate
    'yes, I really do want to try that broken video again'."""
    kind, file_path = _resolve(file_hash, kind_name)

    requeue_expired()
    if enqueue(kind, file_hash, force="force" in request.args):
        SUBMIT[kind.name](file_hash, file_path)
    return jsonify(_serialized(kind, file_hash)), 202


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
    file_hash = hash_stream(file.stream, chunk_size=4096).lower()
    file.stream.seek(
        0
    )  # Reset the file pointer back to the start so you can save it later

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
