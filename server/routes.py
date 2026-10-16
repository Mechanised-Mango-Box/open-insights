import json
import os
from pathlib import Path
from uuid import uuid4

from auth import is_private, limiter
from config import (
    ALLOWED_EXTENSIONS,
    MODEL_TRAINING,
    MORE_MODELS_URL,
    PUBLIC_COMPUTE_RATE_LIMIT,
    PUBLIC_MAX_QUEUE_DEPTH,
    PUBLIC_MAX_TRAINED_MODELS,
    PUBLIC_TRAIN_RATE_LIMIT,
    PUBLIC_UPLOAD_RATE_LIMIT,
    SHOW_INSTRUCTIONS,
    UNVERSIONED_PACKAGES,
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
from flask import Blueprint, current_app, jsonify, make_response, redirect, request
from instructions import page_html
from model_portal import PORTAL_CSS, models_card_html
from model_registry import ModelError, ModelExists
from werkzeug.exceptions import NotFound
from processing import SUBMIT, queue_status
from utils import Failure, hash_stream
from video_files import check_video

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
    return make_response(page_html(request.host_url, models_card_html(), PORTAL_CSS))


@bp.get("/status")
def __route_status():
    """Liveness plus what the queue and the workers are doing. Deliberately does
    not call requeue_expired(), unlike the dataset GET below: this is an
    observability read, the backfill sweep already reclaims dead leases on its own
    timer, and with backfill switched off a 'running' job that no worker is on is
    exactly the thing you came here to see.

    unversioned_packages is empty on a healthy server. Anything in it means this
    server stamps its results differently from one that can read those versions,
    so results carried between the two read as stale - see config.py. It is here
    because the warning config.py prints goes to a console that someone running a
    portable build may never look at."""
    return jsonify(
        {"status": "ok", "unversioned_packages": UNVERSIONED_PACKAGES, **queue_status()}
    )


# A row without its file. Worded as an instruction because re-uploading is the
# whole remedy, and the client does it unprompted on this 404.
_MISSING_FILE = (
    "The video file for '{file_hash}' is not on this server; upload it again to "
    "compute anything new from it."
)


@bp.get("/api/videos/<file_hash>")
def __route_get_video(file_hash: str):
    """Whether this server holds the video itself - the client's sourceStatus()
    probe, which turns a 404 here into an upload.

    Answered from the file rather than the row, because the two come apart: a
    database carried over from another server names every video that server had,
    and brings none of their bytes. Trusting the row told the client the video
    was here, so it never re-uploaded, and the work it then asked for failed one
    job at a time with "No such file or directory"."""
    file_ext = get_file_ext(file_hash)
    if file_ext is None:
        return jsonify({"err": f"No uploaded video found for file hash '{file_hash}'."}), 404

    if not (Path(UPLOAD_FOLDER) / f"{file_hash}.{file_ext}").exists():
        return jsonify({"err": _MISSING_FILE.format(file_hash=file_hash)}), 404

    return jsonify({"file_hash": file_hash, "file_ext": file_ext})


# Every dataset kind is served by one pair of handlers below rather than a
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
    transformation the client cannot do for itself - a list stored as a JSON
    string (a transcript's segments, text stats' samples) belongs on the wire as
    an array, under its name without the _json."""
    state = dataset_state(kind, file_hash)
    if state["state"] == "ready":
        for column in [column for column in state if column.endswith("_json")]:
            state[column.removesuffix("_json")] = json.loads(state.pop(column))
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


@bp.get("/api/models")
def __route_models():
    """Every engagement model this server holds, with its card, and which one a
    recommendation that names none is answered by. Reads only the cards (see
    model_registry.py). Adding and deleting packages is the page at /'s job;
    can_train says whether POST /api/models/train will take a new one."""
    registry = current_app.extensions["model_registry"]
    return jsonify(
        {
            "default": registry.default_id,
            "models": registry.entries(),
            "more_models_url": MORE_MODELS_URL,
            "can_train": MODEL_TRAINING,
        }
    )


@bp.post("/api/models/train")
@limiter.limit(PUBLIC_TRAIN_RATE_LIMIT, exempt_when=is_private)
def __route_train_model():
    """Trains an engagement model on the records the client sends and keeps it,
    as an added model every client of this server can then choose.

    The body is {manifest, features, meta}: manifest is an export's manifest.json
    without its files (records with their Scan results and YouTube content),
    features the columns to learn from, and meta the card's id, name and the
    rest (see ModelRegistry.train). One request and wait, like a recommendation:
    a few hundred records train in about a second, which is not worth a job.

    Open to the public tier, rate limited and capped at PUBLIC_MAX_TRAINED_MODELS,
    because nothing the caller sends is unpickled - unlike a package added on the
    page at /. A local server without keys treats every caller as private."""
    if not MODEL_TRAINING:
        return jsonify({"err": "Training models is turned off on this server."}), 403
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"err": "Expected a JSON object with manifest, features and meta."}), 400

    registry = current_app.extensions["model_registry"]
    tier = "private" if is_private() else "public"
    if (
        tier == "public"
        and PUBLIC_MAX_TRAINED_MODELS
        and registry.trained_count("public") >= PUBLIC_MAX_TRAINED_MODELS
    ):
        return (
            jsonify(
                {
                    "err": "This server holds as many trained models as it takes; "
                    "try a local server."
                }
            ),
            503,
        )

    try:
        card, used, skipped = registry.train(
            body.get("manifest"), body.get("features"), body.get("meta"), trained_by=tier
        )
    except ModelExists as e:
        return jsonify({"err": str(e)}), 409
    except ModelError as e:
        return jsonify({"err": str(e)}), 400
    return (
        jsonify(
            {
                "model": registry.entry(card["id"]),
                "used_rows": used,
                "skipped": dict(skipped.most_common()),
            }
        ),
        201,
    )


@bp.post("/api/videos/<file_hash>/recommendation")
def __route_recommendation(file_hash: str):
    """Runs an engagement model over one video: its predicted average percentage
    viewed, and for each feature where the video sits against the training data
    (see EngagementPredictor.predict). ?model=<id> picks the model (see
    /api/models); without it the server's default answers. The response names
    the model that produced it.

    The features arrive in the body, computed by the client from the video's
    Scan results, rather than being read back from this server's datasets: one
    of them - speech pace variation - is only ever computed in the browser. So
    file_hash names the video the answer is about but is not looked up.

    Declared before the <kind_name> route below, and more specific than it:
    "recommendation" is not a DatasetKind, so without this the wildcard would
    take the request and _resolve() would 404 it as an unknown kind. Werkzeug
    prefers the static segment regardless of declaration order, but the two
    being adjacent is what makes the overlap visible to the next reader.
    """
    features = request.get_json(silent=True)
    registry = current_app.extensions["model_registry"]
    try:
        predictor = registry.predictor(request.args.get("model"))
    except ModelError as e:
        return jsonify({"err": str(e)}), 404
    try:
        result = predictor.predict(features)
    except ValueError as e:
        # predict() raises ValueError only for input it will not accept, so this
        # is the caller's mistake and its message is safe to put on the wire.
        return jsonify({"err": str(e)}), 400
    card = predictor.card or {}
    result["model"] = {
        "id": card.get("id") or request.args.get("model") or registry.default_id,
        "name": card.get("name"),
        "version": card.get("version"),
    }
    return jsonify(result), 200


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

    # Nothing can be computed from a video this server does not hold - see the
    # note on the video GET above. Checked here and not in _resolve(), because
    # the dataset GET resolves through it too and must keep serving results that
    # were computed elsewhere and carried here in a database: reading those is
    # the reason to bring one over. Only work needs the bytes.
    #
    # A result that is already current is still served rather than refused:
    # enqueue() would decline to queue it anyway, so the POST the client opens
    # every fetch with must not turn into a 404 over a file it is not going to
    # read. dataset_state() reports a stale result as absent, which is exactly
    # the case that does need the file.
    if not file_path.exists() and dataset_state(kind, file_hash)["state"] != "ready":
        raise _not_found(_MISSING_FILE.format(file_hash=file_hash))

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
        accepted = ", ".join(f".{ext}" for ext in sorted(ALLOWED_EXTENSIONS))
        return jsonify({"err": f"Not a video type this server accepts ({accepted})."}), 415

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
        # > Check the content. The name alone let anything called .mp4 in, to
        # be hashed, stored and queued, and then fail once per dataset kind when
        # a worker came to decode it. Checked after the save because FFmpeg
        # reads a file, and before the rename so a rejected one never takes the
        # final name.
        match check_video(Path(tmp_path), file_ext):
            case Failure(error):
                Path(tmp_path).unlink(missing_ok=True)
                return jsonify({"err": error}), 415
        os.replace(tmp_path, file_path)
    except BaseException:
        Path(tmp_path).unlink(missing_ok=True)
        raise

    insert_file(file_hash, file_ext)
    return jsonify({"file_hash": file_hash, "filename": file_name}), 201, headers
