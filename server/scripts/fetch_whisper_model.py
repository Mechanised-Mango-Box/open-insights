"""Pulls or updates the faster-whisper model the server expects to find locally.

The server runs with local_files_only=True and never contacts Hugging Face
(see processing.py) - this script is the only thing that does. Run it by hand
after cloning, on a fresh box, whenever WHISPER_MODEL changes, or to refresh a
pinned model's weights. It reads the same WHISPER_MODEL / WHISPER_MODEL_DIR
env vars as the server, so both always agree on what's cached and where.

Safe to re-run: a cached, up-to-date model resolves with a quick local check
and no download.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import WHISPER_MODEL, WHISPER_MODEL_DIR  # noqa: E402
from faster_whisper.utils import download_model  # noqa: E402


def main() -> None:
    destination = WHISPER_MODEL_DIR or "(default Hugging Face cache)"
    print(f"Fetching faster-whisper model '{WHISPER_MODEL}' into {destination} ...")
    path = download_model(WHISPER_MODEL, cache_dir=WHISPER_MODEL_DIR)
    print(f"Model ready at: {path}")


if __name__ == "__main__":
    main()
