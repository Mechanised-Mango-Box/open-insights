"""Entry point for the packaged build. See scripts/build_portable.py.

Separate from main.py because a frozen executable has obligations a development
server does not: it is started by double-clicking rather than by someone at a
prompt, its data directory may not exist or may not be writable, and if it dies
during startup the console it was given disappears with it.

Everything specific to being frozen lives here, so main.py stays the two lines
the README describes.
"""

import multiprocessing
import os
import sys
import traceback
from pathlib import Path


def _wait_for_keypress(message: str) -> None:
    """Hold the console open on Windows.

    A double-clicked .exe owns its console window, and the window closes when
    the process exits - so an error printed on the way out is displayed for
    about as long as it takes to read nothing at all. On a terminal that was
    already open this is just noise, so it only fires where the problem exists.
    """
    if sys.platform != "win32" or not sys.stdin or not sys.stdin.isatty():
        return
    try:
        input(f"\n{message}")
    except (EOFError, KeyboardInterrupt):
        pass


def _prepare_data_dirs() -> None:
    """Create the data directories, with a readable failure if we cannot.

    app.py creates these too, but it does so several seconds into an import that
    also loads the transcription model - so without this, unzipping into a
    read-only location is reported as a stack trace from deep inside startup,
    after a wait, rather than as the one sentence it is.
    """
    from config import DB_PATH, UPLOAD_FOLDER

    for directory in (Path(UPLOAD_FOLDER), Path(DB_PATH).parent):
        try:
            directory.mkdir(parents=True, exist_ok=True)
        except OSError as err:
            raise SystemExit(
                f"Cannot create the data directory:\n\n    {directory}\n\n"
                f"    {err}\n\n"
                "The server keeps its database and uploaded videos beside the\n"
                "executable, so it needs somewhere it may write. Move the\n"
                "executable out of a read-only or protected location (Program\n"
                "Files, for instance), or set UPLOAD_FOLDER and DB_PATH to\n"
                "somewhere it can write."
            ) from err

        if not os.access(directory, os.W_OK):
            raise SystemExit(
                f"The data directory is not writable:\n\n    {directory}\n\n"
                "Move the executable somewhere you own, or set UPLOAD_FOLDER\n"
                "and DB_PATH."
            )


def main() -> None:
    _prepare_data_dirs()

    # Imported here rather than at module scope: importing app builds the
    # transcription model and starts the background threads, and none of that
    # should happen before the directories it will write to are known good.
    from app import app
    from config import SERVER_HOST, SERVER_PORT, SHOW_INSTRUCTIONS
    from instructions import banner_text

    if SHOW_INSTRUCTIONS:
        print(banner_text(), flush=True)

    # The Werkzeug server, not gunicorn: gunicorn is POSIX-only and this build
    # targets Windows as well. It is also what the README has always prescribed
    # for a server on your own machine, which is the entirety of what this is.
    # The backfill and reaper threads are daemons, so Ctrl-C ends the process
    # rather than hanging on them.
    app.run(host=SERVER_HOST, port=SERVER_PORT, threaded=True)


if __name__ == "__main__":
    # Before anything else. PyInstaller re-executes the bundle for child
    # processes, and without this a library that reaches for multiprocessing
    # would start the whole server again instead of a worker. Nothing does
    # today; it costs one line to keep that true of a dependency's next release.
    multiprocessing.freeze_support()

    try:
        main()
    except KeyboardInterrupt:
        pass
    except SystemExit as err:
        # Our own diagnostics from _prepare_data_dirs, which are sentences
        # rather than tracebacks and should be read as such.
        if err.code not in (0, None):
            print(f"\n{err.code}", file=sys.stderr)
            _wait_for_keypress("Press Enter to close.")
            raise SystemExit(1) from None
    except Exception:
        traceback.print_exc()
        _wait_for_keypress("Press Enter to close.")
        raise SystemExit(1) from None
