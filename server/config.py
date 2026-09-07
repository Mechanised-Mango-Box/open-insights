import os
from typing import cast

from models import FileExt

UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER", "../data/local/uploads")
ALLOWED_EXTENSIONS = {"mp4", "avi", "mov", "mkv", "webm"}
DB_PATH = os.environ.get("DB_PATH", "../data/local/db.sqlite")

# How long a statement waits for SQLite's write lock before giving up. See the
# note in db.py for why WAL alone is not enough.
#
# 30s rather than the 5s this started at, because the timeout is wall-clock and
# the lock holder is competing for CPU to reach its commit. A full batch runs
# four jobs at once, and OpenCV and CTranslate2 each spread across every core -
# measured at 93 threads and 850% CPU on a 16-core box. A request thread can
# then wait seconds simply to be scheduled, and 5s of real time expired before
# the writer got there: uploads 500'd with "database is locked" exactly when the
# last of them collided with the work starting on all the rest.
#
# This treats the symptom. The cause is the oversubscription, and capping the
# pools below is what actually fixes it.
DB_BUSY_TIMEOUT_MS = int(os.environ.get("DB_BUSY_TIMEOUT_MS", "30000"))

# Videos are large, so this is a stop rather than a policy. Left unset, Flask
# reads a body of any size into a spool file, which - with no auth and a public
# origin in the CORS list - is one request away from filling the disk.
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(4 * 1024**3)))

# Whisper runs through CTranslate2 (faster-whisper). device/compute_type are the
# only settings that differ between a CPU box and a cloud GPU instance - cpu/int8
# here, cuda/float16 there - so moving to a GPU is a config change, not a rewrite.
# Set explicitly rather than device="auto" + compute_type="default", because
# "default" resolves to float32 on CPU and gives back the little that int8 buys.
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "tiny.en")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

# Pinned rather than left to auto-detection. The default weights are already an
# English-only build, so this matches the model rather than constraining it; it
# stays explicit because the model is an env var and a multilingual one set there
# would otherwise silently fall back to detection.
#
# Detection otherwise runs on the first 30s window alone, so an instrumental
# intro or a few accented seconds can mislabel an entire talk and return it
# transcribed as the wrong language. Pinning removes that failure mode outright
# and skips the detection pass. It is an input to TRANSCRIPT_PRODUCER below, so
# changing it invalidates transcripts made under a different language instead of
# mixing them into one corpus.
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "en")

# 0 lets CTranslate2 choose, which measured fastest: on a 300s clip this box did
# 57.9s letting CT2 decide vs 69.3s pinned to 16 threads (measured on turbo, so
# the absolute times are far above what the current default takes), and the
# *previous* engine likewise got 8% slower when handed twice the threads. More
# threads is not a free lever here - change this only with a measurement in hand.
WHISPER_CPU_THREADS = int(os.environ.get("WHISPER_CPU_THREADS", "0"))

# How many transcriptions may run at once. This is CTranslate2's inter_threads:
# the weights are loaded once and each worker adds only its own compute buffers,
# so a second worker costs a few hundred MB, not another copy of the weights.
#
# This is the knob that actually buys parallelism; the Python lock that used to
# sit around transcribe() was never what serialised the work. Measured on 60s
# clips, 16 threads, turbo/int8 - the shape of the curve is what matters here,
# not the absolute numbers, which a smaller model moves wholesale:
#
#   workers  concurrent  throughput   cores  model RSS
#         1           1       3.49x    3.94     2063MB
#         1           2       3.45x    3.92     2121MB  <- lock removal alone
#         2           2       4.81x    7.40     2412MB  <- default
#         4           4       5.10x   10.97     3056MB
#         8           4       5.46x    9.19     3685MB
#
# Row 2 is why num_workers has to move with the lock: two concurrent callers at
# inter_threads=1 ran no faster than one at a time, because CT2 queues them
# internally regardless of what Python does.
#
# 2 is where the curve bends. It takes most of the available speedup (1.38x of an
# eventual 1.56x) for the least memory, and burns 1.54 CPU-seconds per audio-
# second against 2.15 at four workers - past two, the extra cores go to
# oversubscription rather than output. It also sits near this box's 8 physical
# cores; the remaining 8 are hyperthreads, which int8 GEMM does not use well.
# Raise it on a machine with more real cores, with a measurement in hand.
WHISPER_NUM_WORKERS = int(os.environ.get("WHISPER_NUM_WORKERS", "2"))

# Voice-activity filtering skips silence before the model sees it. Measured as no
# help on continuous speech (a 42-min talk went 69.3s -> 68.7s), so it defaults
# off to keep output closest to the previous engine's; it earns its keep on
# sparse audio, hence the flag.
WHISPER_VAD = os.environ.get("WHISPER_VAD", "0") == "1"

# Where CTranslate2 weights live (~75MB for tiny.en, ~1.6GB for turbo). Point
# this at a baked image path or mounted volume in cloud so a cold container
# doesn't download them on its first request. None means the default
# HuggingFace cache.
#
# The server runs with local_files_only=True (see processing.py) and never
# downloads, so this directory must already be populated before it starts.
# Run scripts/fetch_whisper_model.py to pull or update the model into it - it
# reads this same env var, so the two always agree on location.
WHISPER_MODEL_DIR = os.environ.get("WHISPER_MODEL_DIR") or None

# How different a frame must be from its predecessor to count as a scene change.
# Lifted out of processing.py, where it sat as a default argument that nothing
# ever passed: as config it becomes a real input to SCENE_STATS_PRODUCER, so
# changing it invalidates the cached results it would change.
SCENE_THRESHOLD = float(os.environ.get("SCENE_THRESHOLD", "30.0"))

# Scene stats get their own pool, sized independently of WHISPER_NUM_WORKERS.
# The OpenCV frame loop is one serial pass over every frame, so extra workers
# here buy concurrent *videos*, not a faster single scan.
SCENE_STATS_WORKERS = int(os.environ.get("SCENE_STATS_WORKERS", "2"))

# Stamped onto every cached result. A row whose producer no longer matches was
# made by a different model or a different parameter, so it reads as absent and
# gets recomputed rather than silently mixing with current results and skewing
# the wpm/word_count/scene_change_rate features built off them.
TRANSCRIPT_PRODUCER = f"faster-whisper/{WHISPER_MODEL}/{WHISPER_LANGUAGE}"
SCENE_STATS_PRODUCER = f"opencv/threshold={SCENE_THRESHOLD}"

# A job whose worker died is requeued rather than failed, so a genuinely broken
# video would otherwise retry forever. Past this many attempts it stays failed
# until someone explicitly POSTs a retry.
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "3"))

# How long a claimed job may run before another process may assume its worker is
# gone and requeue it. Generously longer than the slowest plausible transcription
# (a 42-min talk takes ~11 min on CPU), because requeueing work that is in fact
# still running wastes an entire job.
JOB_LEASE_SECONDS = int(os.environ.get("JOB_LEASE_SECONDS", str(2 * 60 * 60)))

# The idle sweep is the only thing in the server that starts work nobody asked
# for, so it gets a switch. 0 restores the previous behaviour exactly: work
# begins on POST and at startup, never on its own.
BACKFILL_ENABLED = os.environ.get("BACKFILL_ENABLED", "1") == "1"

# How often the sweeper wakes. The scan is two indexed queries per kind, so the
# cost is nothing; this is really "how long a freshly uploaded video waits before
# the server starts on it unprompted".
BACKFILL_INTERVAL_SECONDS = int(os.environ.get("BACKFILL_INTERVAL_SECONDS", "30"))


def video_extension(filename: str) -> FileExt | None:
    """The single place a filename becomes an extension, or None if it is not one
    this server accepts.

    Returning the extension rather than a bool is what keeps validation and
    derivation from drifting. They used to be two parses - this predicate said
    yes via rsplit('.', 1), while the caller took the value from
    os.path.splitext() - and the two disagree on a name that is nothing but an
    extension: '.mp4' passes the first and yields '' from the second, which then
    reached the database as a file_ext that FileExt says cannot exist."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return cast(FileExt, ext) if ext in ALLOWED_EXTENSIONS else None
