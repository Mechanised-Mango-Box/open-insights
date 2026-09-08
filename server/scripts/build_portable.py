"""Builds the portable, single-file server.

    python scripts/build_portable.py

Produces dist/open-insights-server-<platform>-<arch>[.exe]: one executable that
needs no Python, no pip, and no network - the transcription weights are staged
into the bundle here, at build time, because the server loads them with
local_files_only=True and a bundle without them does not fail a request, it
fails to boot.

PyInstaller cannot cross-compile. The Windows executable has to be built on
Windows and the Linux one on Linux, which is why this is Python rather than the
shell script it would otherwise be. Build the Linux one on the oldest glibc you
intend to support - inside python:3.13-slim-bookworm, for instance - because the
result will not run on anything older than the machine that produced it.
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
BUILD_DIR = SERVER_DIR / "build"
# PyInstaller's scratch space, kept out of build/models so that clearing one
# does not take the other with it.
WORK_DIR = BUILD_DIR / "pyinstaller"
MODEL_STAGE_DIR = BUILD_DIR / "models"
HF_CACHE_DIR = BUILD_DIR / "hf-cache"
DIST_DIR = SERVER_DIR / "dist"
SPEC = SERVER_DIR / "open-insights.spec"

sys.path.insert(0, str(SERVER_DIR))

# The version the Dockerfile pins, and the only one this is tested on. Not
# enforced: 3.13 is required there for a complete set of aarch64 wheels, which
# is a constraint of that target rather than of the code, and refusing to build
# on the interpreter someone actually has is unhelpful when it may well work.
TESTED_PYTHON = (3, 13)

REQUIRED_PACKAGES = {
    "PyInstaller": "pyinstaller",
    "faster_whisper": "faster-whisper",
    "cv2": "opencv-python-headless",
    "flask": "flask",
    "pandas": "pandas",
}


def check_environment(install: bool) -> None:
    if sys.version_info[:2] != TESTED_PYTHON:
        have = ".".join(str(part) for part in sys.version_info[:2])
        want = ".".join(str(part) for part in TESTED_PYTHON)
        print(
            f"! Building on Python {have}; {want} is what the Dockerfile pins and\n"
            f"  what this is tested on. Native wheels for ctranslate2, onnxruntime\n"
            f"  and av are the thing most likely to be missing elsewhere.\n"
        )

    missing = []
    for module, distribution in REQUIRED_PACKAGES.items():
        try:
            __import__(module)
        except ImportError:
            missing.append(distribution)

    if not missing:
        return

    if not install:
        # Deliberately not installing without being asked: this runs in whatever
        # environment it was started in, and quietly writing into someone's
        # system interpreter is not this script's decision to make.
        raise SystemExit(
            "Missing build dependencies: "
            + ", ".join(missing)
            + "\n\nInstall them with:\n"
            "    pip install -r requirements.txt pyinstaller\n\n"
            "or re-run this script with --install-deps."
        )

    print(f"Installing build dependencies: {', '.join(missing)}")
    run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "pyinstaller"])


def run(command: list[str]) -> None:
    print("$ " + " ".join(command))
    subprocess.run(command, check=True, cwd=SERVER_DIR)


def stage_model() -> None:
    """Fetch the weights and flatten them into build/models/<model>.

    The same download_model() that scripts/fetch_whisper_model.py uses, so a
    build and a development machine cannot end up with different weights under
    the same name.

    Flattened rather than bundled as the Hugging Face cache directory it arrives
    in, for two reasons. That layout keeps its real files in blobs/ and points at
    them from snapshots/ with symlinks, which PyInstaller resolves - shipping
    every file twice. And reading it back needs huggingface_hub to resolve a
    revision offline, from inside a temporary directory, on a machine that may
    have no network at all. faster-whisper takes a plain directory of CTranslate2
    files as its model argument, so the flat copy skips both problems.
    """
    from config import WHISPER_MODEL
    from faster_whisper.utils import download_model

    destination = MODEL_STAGE_DIR / WHISPER_MODEL
    print(f"Staging model '{WHISPER_MODEL}' into {destination} ...")

    HF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    snapshot = Path(download_model(WHISPER_MODEL, cache_dir=str(HF_CACHE_DIR)))

    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)

    for item in sorted(snapshot.iterdir()):
        if item.is_file() or item.is_symlink():
            # copy, not copy2: follows the symlink into blobs/ and writes a real
            # file, which is what has to end up in the bundle.
            shutil.copy(item, destination / item.name)

    staged = sorted(path.name for path in destination.iterdir())
    total = sum(path.stat().st_size for path in destination.iterdir())
    print(f"  {len(staged)} files, {total / 1024**2:.0f} MB: {', '.join(staged)}")

    # The tokenizer and the weights themselves. Missing either means a bundle
    # that builds cleanly and dies on the user's machine at import.
    for required in ("model.bin", "tokenizer.json"):
        if not (destination / required).is_file():
            raise SystemExit(f"Staged model is missing {required} - refusing to build.")


def artifact_name() -> str:
    platform = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")
    machine = {"AMD64": "x86_64", "x86_64": "x86_64", "aarch64": "arm64"}.get(
        os.uname().machine if hasattr(os, "uname") else os.environ.get("PROCESSOR_ARCHITECTURE", ""),
        "x86_64",
    )
    suffix = ".exe" if sys.platform == "win32" else ""
    return f"open-insights-server-{platform}-{machine}{suffix}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--install-deps",
        action="store_true",
        help="pip install the build dependencies into the current environment",
    )
    parser.add_argument(
        "--skip-model",
        action="store_true",
        help="reuse the model already staged in build/models (faster rebuilds)",
    )
    parser.add_argument(
        "--clean", action="store_true", help="discard PyInstaller's cached analysis"
    )
    args = parser.parse_args()

    check_environment(args.install_deps)

    if args.skip_model:
        if not any(MODEL_STAGE_DIR.glob("*/model.bin")):
            raise SystemExit(f"Nothing staged in {MODEL_STAGE_DIR}; drop --skip-model.")
        print(f"Reusing the model already staged in {MODEL_STAGE_DIR}")
    else:
        stage_model()

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        str(SPEC),
        "--noconfirm",
        "--workpath",
        str(WORK_DIR),
        "--distpath",
        str(DIST_DIR),
    ]
    if args.clean:
        command.append("--clean")
    run(command)

    built = DIST_DIR / ("open-insights-server.exe" if sys.platform == "win32" else "open-insights-server")
    if not built.is_file():
        raise SystemExit(f"PyInstaller reported success but {built} is not there.")

    final = DIST_DIR / artifact_name()
    if final != built:
        final.unlink(missing_ok=True)
        built.rename(final)

    size = final.stat().st_size / 1024**2
    print(f"\nBuilt {final}  ({size:.0f} MB)")
    print(
        "\nIt unpacks itself on every launch, so the first few seconds are the\n"
        "bundle extracting and the model loading. Run it from the directory it\n"
        "should keep its data in - the database and uploads land beside it."
    )


if __name__ == "__main__":
    main()
