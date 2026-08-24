import csv
import hashlib
import io
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Generic, TypeVar

from flags import PLATFORM, Platform
from universe import Universe

if PLATFORM is Platform.WEB:
    import js  # pyrefly: ignore [missing-import]
from imgui_bundle import portable_file_dialogs

T = TypeVar("T")  # Generic
E = TypeVar("E")  # generic Error


class Ref(Generic[T]):
    def __init__(self, value: T):
        self._: T = value


# region Result types
@dataclass(frozen=True)
class Success(Generic[T]):
    value: T


@dataclass(frozen=True)
class Failure(Generic[E]):
    error: E


Result = Success[T] | Failure[E]
# endregion


def e_str(x: object) -> str:
    """
    Cast to string that handles empty.
    """
    return str(x) if x else ""


def tuple_to_csv_row(t: Iterable[Any]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(t)
    return output.getvalue().rstrip("\r\n")


def file_hash(path: Path, algo: str = "sha256", chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.new(algo)
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


Uint8Array = Any


def file_select_native(
    dialog_title: str,
    file_filter_desc: str,
    file_filter_match: str,
):
    # ) -> Result[list[Path], str]:
    selection = portable_file_dialogs.open_file(
        dialog_title,
        ".",
        [file_filter_desc, file_filter_match],
        options=portable_file_dialogs.opt.none,
    ).result()
    print(selection)
    new_file_paths = [Path(s) for s in selection]
    Universe.new_file_paths = new_file_paths


def file_select_web(
    file_filter_MIMEs: list[str] | None = None,
):
    try:
        print("Triggering file picker...")
        file_input = js.document.getElementById("file-picker")
        if file_input:
            file_input.accept = ",".join(file_filter_MIMEs) if file_filter_MIMEs else ""
            file_input.click()
        else:
            print("HTML element 'file-picker' not found")
    except Exception as e:
        print(f"Error: {e}")


def js_fs_import_file_begin():
        print("Ready to submit files")
        Universe.new_file_paths = []

def js_fs_import_file(filename: str, uint8_array: "Uint8Array"):
    path = Path(filename)
    try:
        file_bytes = bytes(uint8_array)

        print(f"Successfully received file! Size: {len(file_bytes)} bytes")

        # Write to emscripten
        with open(path, "wb") as f:
            f.write(file_bytes)

        print(f"File saved to {path}")
        print("TODO: trigger FS refresh")

        if Universe.new_file_paths is None:
            Universe.new_file_paths = []
        Universe.new_file_paths.append(path)

    except Exception as e:
        print(f"Error processing file in Python: {e}")
