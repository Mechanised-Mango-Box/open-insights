import json
import os
from pathlib import Path
from uuid import uuid4

from auth import is_private, limiter
from config import (
    PUBLIC_COMPUTE_RATE_LIMIT,
    PUBLIC_MAX_QUEUE_DEPTH,
    PUBLIC_UPLOAD_RATE_LIMIT,
    SHOW_INSTRUCTIONS,
    UPLOAD_FOLDER,
    video_extension,
)
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
from instructions import page_html
from werkzeug.exceptions import NotFound
from processing import SUBMIT, queue_status
from utils import hash_stream

bp = Blueprint("api", __name__)


@bp.get("/")
def __route_root():
    """Setup instructions for a local server, the status redirect for a public one.

    Someone who opens the address a packaged server printed has arrived here
    looking for what to do next, and a redirect to a JSON object does not answer
    that. With SHOW_INSTRUCTIONS off this is byte-identical to what it has always
    been - a deployment's landing page is not the place to explain how to point a
    client somewhere else.

    Exempt from the API key check in auth.py, so this stays reachable on a local
    server that happens to have keys configured. See instructions.py for why
    there is nothing here to gate.
    """
    if not SHOW_INSTRUCTIONS:
        return redirect("/status")
    return make_response(page_html(request.host_url))


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


@bp.post("/api/videos/<file_hash>/recommendation")
def __route_recommendation(file_hash: str):
    """Runs the trained model over one video and returns what it says about each
    feature.

    Declared before the <kind_name> route below, and more specific than it:
    "recommendation" is not a DatasetKind, so without this the wildcard would
    take the request and _resolve() would 404 it as an unknown kind. Werkzeug
    prefers the static segment regardless of declaration order, but the two
    being adjacent is what makes the overlap visible to the next reader.

    Unimplemented, so it answers 501 rather than an empty 200 - the client shows
    the message, and "not implemented" is more use to it than a blank result
    that looks like a model with no opinion.
    """
    # TODO: Implement
    return jsonify({"err": "Recommendations are not implemented yet."}), 501


@bp.post("/api/videos/<file_hash>/<kind_name>")
@limiter.limit(PUBLIC_COMPUTE_RATE_LIMIT, exempt_when=is_private)
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

    # Depth, not rate, is what bounds CPU on a small box. A rate limit caps how
    # often work is asked for; this caps how much is outstanding, which is the
    # number that decides whether accepting one more is a service or a lie. 503
    # with Retry-After rather than a silent accept, so the client can report
    # "busy, try later" instead of polling for ten minutes behind a queue that
    # was never going to reach it.
    #
    # Only when there is nothing cached to hand back. The client opens every
    # fetch with a POST (see the docstring above), so a depth check that fired
    # unconditionally would turn a deep queue into a wall in front of results
    # that are already computed and cost nothing to serve - refusing reads to
    # protect the CPU from work it was not being asked to do.
    if PUBLIC_MAX_QUEUE_DEPTH and not is_private():
        already_have = dataset_state(kind, file_hash)["state"] == "ready"
        if not already_have and queue_status()["queue"]["queued"] >= PUBLIC_MAX_QUEUE_DEPTH:
            return (
                jsonify({"err": "Server is busy; try again shortly."}),
                503,
                {"Retry-After": "120"},
            )

    queued = enqueue(kind, file_hash, force="force" in request.args)
    if queued:
        SUBMIT[kind.name](file_hash, file_path)
    # 202 Accepted only when something actually was. Declining to queue and
    # returning the result that made queueing unnecessary is a 200.
    return jsonify(_serialized(kind, file_hash)), 202 if queued else 200


@bp.post("/api/videos")
@limiter.limit(PUBLIC_UPLOAD_RATE_LIMIT, exempt_when=is_private)
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
