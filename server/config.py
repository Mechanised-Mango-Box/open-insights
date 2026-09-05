import os

UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER", "../data/local/uploads")
ALLOWED_EXTENSIONS = {"mp4", "avi", "mov", "mkv", "webm"}
DB_PATH = os.environ.get("DB_PATH", "../data/local/db.sqlite")

# Whisper runs through CTranslate2 (faster-whisper). device/compute_type are the
# only settings that differ between a CPU box and a cloud GPU instance - cpu/int8
# here, cuda/float16 there - so moving to a GPU is a config change, not a rewrite.
# Set explicitly rather than device="auto" + compute_type="default", because
# "default" resolves to float32 on CPU and gives back the little that int8 buys.
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "turbo")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

# 0 lets CTranslate2 choose, which measured fastest: on a 300s clip this box did
# 57.9s letting CT2 decide vs 69.3s pinned to 16 threads, and the *previous*
# engine likewise got 8% slower when handed twice the threads. More threads is
# not a free lever here - change this only with a measurement in hand.
WHISPER_CPU_THREADS = int(os.environ.get("WHISPER_CPU_THREADS", "0"))

# Voice-activity filtering skips silence before the model sees it. Measured as no
# help on continuous speech (a 42-min talk went 69.3s -> 68.7s), so it defaults
# off to keep output closest to the previous engine's; it earns its keep on
# sparse audio, hence the flag.
WHISPER_VAD = os.environ.get("WHISPER_VAD", "0") == "1"

# Where CTranslate2 weights live (~1.6GB for turbo). Point this at a baked image
# path or mounted volume in cloud so a cold container doesn't download them on
# its first request. None means the default HuggingFace cache.
WHISPER_MODEL_DIR = os.environ.get("WHISPER_MODEL_DIR") or None

# How different a frame must be from its predecessor to count as a scene change.
# Lifted out of processing.py, where it sat as a default argument that nothing
# ever passed: as config it becomes a real input to SCENE_STATS_PRODUCER, so
# changing it invalidates the cached results it would change.
SCENE_THRESHOLD = float(os.environ.get("SCENE_THRESHOLD", "30.0"))

# Stamped onto every cached result. A row whose producer no longer matches was
# made by a different model or a different parameter, so it reads as absent and
# gets recomputed rather than silently mixing with current results and skewing
# the wpm/word_count/scene_change_rate features built off them.
TRANSCRIPT_PRODUCER = f"faster-whisper/{WHISPER_MODEL}"
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


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
