import json
import os
from pathlib import Path
from uuid import uuid4

import pandas as pd
from analysis import compute_correlations, compute_histogram, compute_loess
from config import UPLOAD_FOLDER, video_extension
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
from processing import SUBMIT, queue_status
from utils import hash_stream

bp = Blueprint("api", __name__)


@bp.get("/")
def __reroute_to_status():
    return redirect("/status")


@bp.get("/status")
def __route_status():
    """Liveness plus what the queue and the workers are doing. Deliberately does
    not call requeue_expired(), unlike the dataset GET below: this is an
    observability read, the backfill sweep already reclaims dead leases on its own
    timer, and with backfill switched off a 'running' job that no worker is on is
    exactly the thing you came here to see."""
    return jsonify({"status": "ok", **queue_status()})


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

    Posting over a result that is already producer-current is also nothing:
    enqueue() declines it and the current result comes straight back. That is
    what makes the cache worth keeping - the client opens every fetch with a
    POST, so without it each one re-ran a transcription that already existed.

    ?force=true retries a job that has exhausted MAX_ATTEMPTS, and is also how
    you deliberately regenerate a result that is already current - the
    'yes, I really do want to try that broken video again'."""
    kind, file_path = _resolve(file_hash, kind_name)

    requeue_expired()
    queued = enqueue(kind, file_hash, force="force" in request.args)
    if queued:
        SUBMIT[kind.name](file_hash, file_path)
    # 202 Accepted only when something actually was. Declining to queue and
    # returning the result that made queueing unnecessary is a 200.
    return jsonify(_serialized(kind, file_hash)), 202 if queued else 200


@bp.post("/api/videos")
def __route_create_video():
    # > Has file
    if "file" not in request.files:
        return jsonify({"err": "No file part in the request"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"err": "No video selected"}), 400

    # > Check file extention. One parse, so the extension that is validated is
    # the same one that gets stored - see config.video_extension().
    file_ext = video_extension(file.filename)
    if file_ext is None:
        return jsonify({"err": "Invalid file type"}), 400

    # > Get hash (chunks at a time to reduce blocking load)
    file_hash = hash_stream(file.stream).lower()
    file.stream.seek(
        0
    )  # Reset the file pointer back to the start so you can save it later

    file_name = f"{file_hash}.{file_ext}"

    file_path = os.path.join(UPLOAD_FOLDER, file_name)
    headers = {"Location": f"/api/videos/{file_hash}"}
    if os.path.exists(file_path):
        insert_file(file_hash, file_ext)
        return jsonify({"file_hash": file_hash, "filename": file_name}), 200, headers

    # Written under a temporary name and moved into place, so the final name
    # only ever appears on a whole file. Saving directly to it meant a client
    # that disconnected mid-upload left a truncated video there permanently:
    # the exists() check above would then report it as already uploaded and
    # never repair it, and whisper would transcribe the truncation and cache
    # the short result under a current producer stamp - indistinguishable from
    # a good one. Same directory, so the replace is atomic.
    tmp_path = f"{file_path}.{uuid4().hex}.part"
    try:
        file.save(tmp_path)
        os.replace(tmp_path, file_path)
    except BaseException:
        Path(tmp_path).unlink(missing_ok=True)
        raise

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
    # Presence was checked above; this checks the values are numbers. Without it a
    # null or a string reaches np.asarray(dtype=float) inside compute_loess and
    # raises there, which is a 500 for what is plainly a bad request.
    for column in required:
        df[column] = pd.to_numeric(df[column], errors="coerce")
    bad_rows = df[required].isna().any(axis=1)
    if bad_rows.any():
        listed = ", ".join(str(i) for i in df.index[bad_rows])
        return jsonify({"err": f"Non-numeric or missing value(s) in row(s): {listed}"}), 400

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
