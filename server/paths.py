"""Where this process is, and where the things it ships with live.

Two questions that have different answers depending on how the server was
started, and which config.py would otherwise have to answer with a relative
path and a hope about the working directory.

Imports nothing from the rest of the server on purpose: config.py imports this,
and config.py is imported by almost everything else.
"""

import sys
from pathlib import Path

# Set by PyInstaller's bootloader, absent otherwise. Both are checked because
# `frozen` alone is also set by other freezers, and _MEIPASS is what actually
# tells us the onefile archive was unpacked somewhere.
FROZEN = getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


def base_dir() -> Path:
    """The directory that persistent data belongs beside.

    Frozen, that is the folder holding the executable - which is what makes the
    build portable: unzip it anywhere, and its database and uploads follow it
    rather than landing wherever the user happened to be when they double-clicked.
    Deliberately *not* sys._MEIPASS, which onefile deletes on exit.

    Unfrozen, the repository root. That is the same place the old
    '../data/local' defaults resolved to when run from server/ as the README
    says, so nothing moves for an existing clone - it just stops depending on
    the working directory being right.
    """
    if FROZEN:
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def bundled(*parts: str) -> Path | None:
    """A read-only file baked into the executable, or None when not frozen.

    The onefile archive unpacks to a fresh temporary directory on every launch,
    so paths under it are valid only for the life of the process and must never
    be written to or remembered.
    """
    if not FROZEN:
        return None
    return Path(sys._MEIPASS).joinpath(*parts)  # type: ignore[attr-defined]
