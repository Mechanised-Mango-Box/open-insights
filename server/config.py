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

# Stamped onto every cached transcript so rows produced by a previous engine can
# be spotted and re-run, instead of silently mixing with new ones and skewing the
# wpm/word_count features built off them.
TRANSCRIPT_ENGINE = f"faster-whisper/{WHISPER_MODEL}"


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
