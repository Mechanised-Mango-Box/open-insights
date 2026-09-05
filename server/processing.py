import logging
import threading
import time
from collections import Counter
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import cv2
from faster_whisper import WhisperModel

from config import (
    BACKFILL_ENABLED,
    BACKFILL_INTERVAL_SECONDS,
    SCENE_STATS_WORKERS,
    SCENE_THRESHOLD,
    UPLOAD_FOLDER,
    WHISPER_COMPUTE_TYPE,
    WHISPER_CPU_THREADS,
    WHISPER_DEVICE,
    WHISPER_LANGUAGE,
    WHISPER_MODEL,
    WHISPER_MODEL_DIR,
    WHISPER_NUM_WORKERS,
    WHISPER_VAD,
)
from db import (
    KINDS,
    SCENE_STATS,
    TRANSCRIPT,
    DatasetKind,
    active_job_count,
    claim,
    enqueue,
    fail,
    job_counts,
    put_result,
    queued_jobs,
    requeue_expired,
    scene_stats_values,
    transcript_values,
    uncomputed_datasets,
)
from models import SceneStats, Transcript, TranscriptSegment
from utils import Failure, Result, Success

# Executor threads run with no Flask app context, so app.logger is not reachable
# from them. A module logger is what makes a failure in a background job visible
# at all.
_log = logging.getLogger(__name__)

# Loaded eagerly at import time — every server start pays the model load cost
# upfront rather than making the first request wear it.
_whisper_model = WhisperModel(
    WHISPER_MODEL,
    device=WHISPER_DEVICE,
    compute_type=WHISPER_COMPUTE_TYPE,
    cpu_threads=WHISPER_CPU_THREADS,
    num_workers=WHISPER_NUM_WORKERS,
    download_root=WHISPER_MODEL_DIR,
)

# Runs transcript/scene_stats generation off the request thread so a GET can
# return its "processing" status immediately instead of blocking for the
# duration of the calculation. CTranslate2 and OpenCV do their heavy work in
# native code that releases the GIL, so a thread pool (rather than
# multiprocessing) is sufficient to get real concurrency here.
#
# One pool per kind rather than one shared pool. Transcriptions now occupy a
# worker for minutes at a time and several run at once, so a shared pool would
# let them take every slot and leave a ~12-second scene-stats scan queued behind
# them. Separate pools also let each kind be sized for what its work needs:
# transcription scales with the model's own workers, the serial OpenCV frame
# loop does not.
#
# How many workers each pool gets, named once. queue_status() reports these
# numbers and the executors are built from them, so the figure a caller sees is
# by construction the one the pool actually runs - rather than being read back
# off ThreadPoolExecutor._max_workers, which is private, or restated from config
# in a second place that could drift.
_POOL_SIZES: dict[str, int] = {
    TRANSCRIPT.name: WHISPER_NUM_WORKERS,
    SCENE_STATS.name: SCENE_STATS_WORKERS,
}

_EXECUTORS: dict[str, ThreadPoolExecutor] = {
    TRANSCRIPT.name: ThreadPoolExecutor(
        max_workers=_POOL_SIZES[TRANSCRIPT.name], thread_name_prefix="transcript"
    ),
    SCENE_STATS.name: ThreadPoolExecutor(
        max_workers=_POOL_SIZES[SCENE_STATS.name], thread_name_prefix="scene-stats"
    ),
}

# Which (kind, file_hash) pairs currently have a task sitting in an executor,
# waiting or running. The jobs table cannot answer this: a row reads 'queued'
# both when a worker is about to pick it up and when its worker died and nothing
# replaced it, and only the second needs resubmitting. Held in process because
# that is exactly the scope of the executors it describes - it says nothing about
# any other process, and is empty at startup, which is precisely right for
# executors that are also empty at startup.
_inflight: set[tuple[str, str]] = set()

# How many pool threads are inside a job right now, per kind. _inflight cannot
# answer this either: it counts tasks handed to an executor, which includes those
# still sitting in the executor's own queue for want of a free thread. Incremented
# only once claim() has succeeded, so a worker counts as busy exactly while it
# holds a job's lease - which makes (inflight - busy) the executor's backlog.
_busy: Counter[str] = Counter()

# Guards both of the above. One lock rather than two, so a status read sees a
# consistent pair and the invariant that every busy worker is also inflight -
# which is what keeps that subtraction from going negative - holds at every point
# an observer can look.
_inflight_lock = threading.Lock()


def calculate_transcript(file_path: Path) -> Transcript:
    # Deliberately unsynchronised. WhisperModel.transcribe() keeps no cross-call
    # state: it builds its Tokenizer per call and holds last_speech_timestamp on
    # the stack, while self.model and self.feature_extractor are written once in
    # __init__. The shared last_speech_timestamp that *would* make this unsafe is
    # an attribute of BatchedInferencePipeline, which the note below explains this
    # does not use. Concurrency is bounded by WHISPER_NUM_WORKERS instead, which
    # is the level CTranslate2 actually parallelises at.
    #
    # NOT BatchedInferencePipeline: batching is ~1.5x faster but collapses
    # segments from ~4s to ~25s, which guts the timestamps this exists to
    # produce. faster-whisper also refuses to batch without vad_filter, so
    # there is no fine-grained batched option to reach for.
    #
    # language is passed rather than left to detection: turbo has no .en
    # build, so this is what makes the run English-only. It also drops the
    # detection pass, which read only the first 30s and could label a whole
    # video off an intro.
    segment_iter, _info = _whisper_model.transcribe(
        str(file_path), language=WHISPER_LANGUAGE, vad_filter=WHISPER_VAD
    )
    # transcribe() returns a generator and the model only actually runs as it is
    # consumed, so the transcription happens in this comprehension rather than in
    # the call above.
    segments = [
        TranscriptSegment(start=segment.start, end=segment.end, text=segment.text)
        for segment in segment_iter
    ]
    # Counted off the joined segments rather than any flattened whole-transcript string,
    # so these match what the client gets when it recomputes stats from the segments it
    # holds (transcriptFullText joins the same way) - otherwise the two would drift apart.
    text = " ".join(segment.text for segment in segments)
    return Transcript(
        count_chars=len(text),
        count_words=len(text.split()),
        segments=segments,
    )


def _submit[T](
    kind: DatasetKind,
    file_hash: str,
    file_path: Path,
    calculate: Callable[[Path], T],
    to_values: Callable[[T], dict[str, Any]],
) -> None:
    """The one path from 'a job is queued' to 'a result exists or the job is
    marked failed'. Both dataset kinds run through it, so the lifecycle is
    written once and cannot drift between them.

    claim() is what makes this safe to call more than once for the same hash:
    only the caller whose UPDATE matched a queued row proceeds, so a duplicate
    request never starts a second worker on the same video. The _inflight guard
    below now stops the duplicate one step earlier, so a second caller does not
    even occupy a pool slot to discover it has nothing to do - which is what lets
    the sweep resubmit orphaned jobs without piling up no-op tasks."""
    key = (kind.name, file_hash)
    with _inflight_lock:
        if key in _inflight:
            return
        _inflight.add(key)

    def run() -> None:
        # Tracked rather than inferred, because losing the claim is a real outcome:
        # a duplicate task that never held the job must not decrement _busy on its
        # way out and leave the count reading one worker short forever.
        claimed = False
        try:
            if not claim(kind, file_hash):
                return
            claimed = True
            # After the claim, not before: until it succeeds this thread may be
            # about to discover it has nothing to do, and reporting it as busy on
            # a job it is going to abandon would be a lie for as long as anyone
            # looked.
            with _inflight_lock:
                _busy[kind.name] += 1
            # put_result() is inside the try with calculate(). It used to sit
            # after it, so a failure to *store* a finished result - a lock held
            # past busy_timeout, say, which four writer threads make ordinary -
            # escaped into a Future nobody inspects. The transcript was thrown
            # away silently and the job kept its 'running' lease for the two
            # hours JOB_LEASE_SECONDS allows before anything reclaimed it.
            try:
                result = calculate(file_path)
                put_result(kind, file_hash, to_values(result))
            except Exception as e:
                _log.exception("%s job failed for %s", kind.name, file_hash)
                try:
                    fail(kind, file_hash, str(e))
                except Exception:
                    # The lease sweep is the only remaining route back to a sane
                    # state, so say so rather than vanishing into the Future.
                    _log.exception(
                        "could not mark %s/%s failed", kind.name, file_hash
                    )
        finally:
            # Both released only once the job has reached a terminal state, so
            # nothing resubmits it while it is still being worked on, and a failed
            # job frees its worker in the reporting just as it does in the pool.
            with _inflight_lock:
                if claimed:
                    _busy[kind.name] -= 1
                _inflight.discard(key)

    _EXECUTORS[kind.name].submit(run)


def submit_transcript_job(file_hash: str, file_path: Path) -> None:
    _submit(TRANSCRIPT, file_hash, file_path, calculate_transcript, transcript_values)


# Ported from gui/feature_extraction.py (video_duration_mins, count_scene_transitions),
# orchestrated the same way gui/tab_scenes_stats.py does. NOT based on
# video_analysis/open_cv_functions.py, which opens its VideoCapture at module scope
# against an undefined variable and crashes on import.
def video_duration_mins(video_capture: cv2.VideoCapture) -> Result[float, str]:
    if not video_capture.isOpened():
        return Failure(f"Failed to open video file: {video_capture}")

    fps = video_capture.get(cv2.CAP_PROP_FPS)
    total_frames = video_capture.get(cv2.CAP_PROP_FRAME_COUNT)

    # isOpened() does not cover this: OpenCV opens a container happily and still
    # reports fps 0 for a variable-frame-rate file, and frame count 0 or -1 when
    # the container carries no index. Dividing anyway raised ZeroDivisionError,
    # which reached the user as the job error "float division by zero" - a
    # server bug by appearance, when the real answer is that this file's
    # metadata cannot be read.
    if fps <= 0 or total_frames <= 0:
        return Failure(f"Unreadable video metadata (fps={fps}, frames={total_frames})")

    duration = (total_frames / fps) / 60  # in mins
    return Success(duration)


def count_scene_transitions(
    video_capture: cv2.VideoCapture, threshold: float = SCENE_THRESHOLD
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
        # Threshold passed explicitly rather than left to the default, so the
        # value that shaped this result is the same one SCENE_STATS_PRODUCER
        # records - otherwise a changed config would not invalidate the cache.
        match (
            video_duration_mins(video_capture),
            count_scene_transitions(video_capture, SCENE_THRESHOLD),
        ):
            case (Success(duration_mins), Success(transition_count)):
                return SceneStats(
                    duration_secs=duration_mins * 60,
                    scenes=float(transition_count),
                )
            case errs:
                raise RuntimeError(f"Scene stats calculation failed: {errs}")
    finally:
        video_capture.release()


def submit_scene_stats_job(file_hash: str, file_path: Path) -> None:
    _submit(SCENE_STATS, file_hash, file_path, calculate_scene_stats, scene_stats_values)


# Which submitter runs which kind. Lives here rather than in routes.py so the
# startup resume below and the request path cannot disagree about it.
SUBMIT: dict[str, Callable[[str, Path], None]] = {
    TRANSCRIPT.name: submit_transcript_job,
    SCENE_STATS.name: submit_scene_stats_job,
}


def resubmit_orphaned_jobs() -> int:
    """Hands back to an executor every job the database says is queued but that no
    worker holds. Returns how many were resubmitted.

    Two things create that state, and neither used to have anything watching for
    it. A restart: the job rows outlive the process, its executor does not, so
    init_db would faithfully requeue interrupted work that then sat unattended
    forever - GET is read-only and nothing else picks it up. And requeue_expired(),
    which flips a dead-lease job back to 'queued' without resubmitting it; enqueue()
    will not either, since for an existing row it only restarts a 'failed' one, so
    a later POST returns False and never reaches SUBMIT. Before this the job stayed
    queued until the next restart."""
    resubmitted = 0
    for row in queued_jobs():
        kind = KINDS.get(row["kind"])
        if kind is None:
            continue
        with _inflight_lock:
            if (kind.name, row["file_hash"]) in _inflight:
                continue
        file_path = Path(UPLOAD_FOLDER) / f"{row['file_hash']}.{row['file_ext']}"
        SUBMIT[kind.name](row["file_hash"], file_path)
        resubmitted += 1
    return resubmitted


# Over-fetched so a handful of rows whose video has since been deleted from disk
# do not stall the sweep on their own.
_BACKFILL_CANDIDATES = 20


def _start_missing(kind: DatasetKind) -> bool:
    """Queues one uncomputed video for this kind, if the kind is otherwise idle.
    Returns whether it started anything."""
    if active_job_count(kind) > 0:
        return False

    for row in uncomputed_datasets(kind, _BACKFILL_CANDIDATES):
        file_path = Path(UPLOAD_FOLDER) / f"{row['file_hash']}.{row['file_ext']}"
        # A files row whose video is gone from disk would enqueue, claim and fail:
        # a permanent failure recorded against something nobody asked about.
        # Skipping leaves it as it was - still absent, still fixed by re-uploading.
        if not file_path.exists():
            continue
        # Losing the race to a request thread that enqueued this same hash between
        # the idle check and here is fine and self-correcting: enqueue returns
        # False, so does this, and the next tick tries again against a kind that is
        # now legitimately busy.
        if enqueue(kind, row["file_hash"]):
            SUBMIT[kind.name](row["file_hash"], file_path)
            return True
    return False


def sweep_once() -> None:
    """One pass: reclaim, resubmit, then fill a gap per idle kind. The order
    matters - reclaiming and resubmitting can both produce work, and a kind that
    has just been given some is no longer idle."""
    requeue_expired()
    resubmit_orphaned_jobs()
    for kind in KINDS.values():
        _start_missing(kind)


_JOB_STATUSES = ("queued", "running", "failed")


def queue_status() -> dict[str, Any]:
    """What the job queue and the worker pools are doing right now, as counts.

    Lives here rather than in db.py or routes.py because it is the only place that
    knows both halves. db.dataset_state() is the analogous derived-state function
    and sits in db.py precisely because it needs nothing but rows; this one needs
    the executors, which are this module's.

    Reading a kind's `jobs.running` above its `workers.busy` is not a bug and is
    the most useful thing here: it is a job whose worker died - a previous process,
    or a thread killed outright - still holding its lease until requeue_expired()
    reclaims it. The database remembers such a job; no worker is on it."""
    per_kind: dict[str, Any] = {
        kind: {
            "jobs": dict.fromkeys(_JOB_STATUSES, 0),
            # Filled in below. Seeded for every kind and every status so the shape
            # is the same on an empty database as on a busy one - a client reading
            # counts should never have to distinguish 'zero' from 'absent'.
            "workers": {},
        }
        for kind in KINDS
    }
    for row in job_counts():
        # A kind the database knows and this process does not would be a schema
        # older or newer than the code; count nothing rather than crash the read.
        if row["kind"] in per_kind:
            per_kind[row["kind"]]["jobs"][row["status"]] = row["count"]

    # One acquisition for the whole snapshot, so the numbers reported for the two
    # kinds describe the same instant rather than two.
    with _inflight_lock:
        busy = {kind: _busy[kind] for kind in KINDS}
        submitted = Counter(kind for kind, _ in _inflight)

    for kind, entry in per_kind.items():
        total = _POOL_SIZES[kind]
        entry["workers"] = {
            "total": total,
            "busy": busy[kind],
            "idle": total - busy[kind],
            # Tasks handed to this pool that have not reached a thread yet. Counted
            # from the executors rather than from `jobs.queued`, which is a
            # different number: a queued row this process never submitted (another
            # replica's, or one awaiting the next sweep) is not waiting on a worker
            # here.
            "awaiting_worker": submitted[kind] - busy[kind],
        }

    return {
        "queue": {
            status: sum(entry["jobs"][status] for entry in per_kind.values())
            for status in _JOB_STATUSES
        },
        "workers": {
            key: sum(entry["workers"][key] for entry in per_kind.values())
            for key in ("total", "busy", "idle")
        },
        "kinds": per_kind,
    }


def start_backfill() -> threading.Thread | None:
    """Runs sweep_once on a timer for the life of the process, which is what makes
    the server finish work nobody is watching: a video uploaded and left alone gets
    its datasets anyway, and a job whose worker died gets picked back up without
    needing a restart.

    Daemon, so it never holds up a Ctrl-C. Every tick is wrapped because a sweep is
    best-effort repair: letting one bad tick kill the thread would silently disable
    all of this for the rest of the process's life."""
    if not BACKFILL_ENABLED:
        return None

    def loop() -> None:
        while True:
            time.sleep(BACKFILL_INTERVAL_SECONDS)
            try:
                sweep_once()
            except Exception as e:
                print(f"Backfill sweep failed: {e}")

    thread = threading.Thread(target=loop, name="backfill", daemon=True)
    thread.start()
    return thread
