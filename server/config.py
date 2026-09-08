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

# --- Public deployment gating -------------------------------------------------
#
# Everything below defaults to off, and with none of it set the server behaves
# exactly as it did before any of it existed: no key, no limit, no reaping. That
# is deliberate. A self-hoster running `py main.py` on their own machine is not
# the threat model, and gating is something a *deployment* opts into rather than
# a new baseline everyone pays for.
#
# The threat model is the one the two comments above already describe: a public
# origin, no auth, and a 4GiB body allowance. Two keys rather than one because
# the answer to "who is this?" here has exactly two useful values - the shared
# key published in the client, which anyone has and which therefore has to be
# assumed hostile, and the operator's own, which does not.
PUBLIC_API_KEY = os.environ.get("PUBLIC_API_KEY", "")
PRIVATE_API_KEY = os.environ.get("PRIVATE_API_KEY", "")

# Whether tier resolution does anything at all. Both keys unset means every
# caller is treated as private, which is what keeps the local quickstart working
# with no configuration and no key header.
AUTH_ENABLED = bool(PUBLIC_API_KEY or PRIVATE_API_KEY)

# The public tier's own body limit, applied per-request on top of the global
# MAX_UPLOAD_BYTES above (which stays the private ceiling). 0 means "no separate
# limit" and the global one applies to everyone.
#
# When setting one, err high: this is a video tool, and a cap that rejects an
# ordinary ten-minute upload makes the public tier a demo rather than a service.
# The compose file uses 512MB.
PUBLIC_MAX_UPLOAD_BYTES = int(os.environ.get("PUBLIC_MAX_UPLOAD_BYTES", "0"))

# How many jobs may be waiting before the public tier is told to come back later.
# 0 disables the check.
#
# This, not the rate limit, is what actually bounds CPU. A rate limit caps how
# often work is *asked for*; on a 2-core box the queue is what decides whether
# asking again is pointless. Rejecting at the door with a 503 is kinder than
# accepting work that will sit behind an hour of someone else's.
PUBLIC_MAX_QUEUE_DEPTH = int(os.environ.get("PUBLIC_MAX_QUEUE_DEPTH", "0"))

# Per-IP rate limits for the public tier, in flask-limiter's syntax. The private
# key is exempt from all three.
#
# The read limit has to be generous or normal use trips it: the client polls a
# pending dataset every 1.5s (40/min each) and a bulk scan has several in flight
# at once. The two write limits are where the actual cost is - an upload spends
# bandwidth and disk, and starting a dataset spends minutes of CPU - so they are
# counted per hour, which is the timescale a person works on, rather than per
# minute, which only smooths bursts.
PUBLIC_RATE_LIMIT = os.environ.get("PUBLIC_RATE_LIMIT", "600 per minute")
PUBLIC_UPLOAD_RATE_LIMIT = os.environ.get("PUBLIC_UPLOAD_RATE_LIMIT", "20 per hour")
PUBLIC_COMPUTE_RATE_LIMIT = os.environ.get("PUBLIC_COMPUTE_RATE_LIMIT", "120 per hour")

# Cap on the upload directory, past which the least recently used videos are
# deleted until it fits. 0 - the default - never deletes anything.
#
# Off by default because deleting someone's uploads is not a reasonable thing to
# do to a self-hoster who has a disk and expects it to be used. On a shared box
# it is the only thing standing between a public endpoint and a full volume,
# since nothing else in the server has ever removed an upload.
#
# Deleting is safe rather than lossy: uploads are content-addressed and this
# directory is a cache. The client holds the library in IndexedDB and re-uploads
# on demand, so a reaped video costs one upload, not a record.
UPLOAD_DIR_MAX_BYTES = int(os.environ.get("UPLOAD_DIR_MAX_BYTES", "0"))

# How often the reaper wakes. It stats the upload directory, so unlike the
# backfill sweep this is not free - hence minutes rather than seconds. Nothing
# here needs to react quickly: the cap is a watermark, not a quota.
UPLOAD_REAP_INTERVAL_SECONDS = int(os.environ.get("UPLOAD_REAP_INTERVAL_SECONDS", "300"))

# Origins the browser client may call from. Env-overridable (comma-separated)
# rather than the hardcoded list this used to be: a self-hoster serving the
# client from anywhere else had to edit source to be allowed in.
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:4200,http://localhost,https://mechanised-mango-box.github.io",
    ).split(",")
    if origin.strip()
]

# --- End public deployment gating ---------------------------------------------

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
