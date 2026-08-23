import csv
import hashlib
import io
from collections.abc import Iterable
from dataclasses import dataclass
from enum import Enum, auto
from pathlib import Path
from typing import Any, Generic, TypeVar

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


class Runtime(Enum):
    NATIVE = auto()
    WEB = auto()


Uint8Array = Any


def file_select(runtime: Runtime) -> Result[list[Path], str]:
    match runtime:
        case Runtime.NATIVE:
            selection = portable_file_dialogs.open_file(
                "Upload Youtube Content Report...",
                ".",
                ["Youtube Content Report (CSV)", "*.csv"],
                options=portable_file_dialogs.opt.none,
            ).result()
            return Success([Path(s) for s in selection])

        case Runtime.WEB:
            try:
                js_file_picker()

                return Success([])

            except Exception as exc:
                return Failure(str(exc))


def js_file_picker():
    try:
        print("Triggering file picker...")
        file_input = js.document.getElementById("file-picker")
        if file_input:
            file_input.click()
        else:
            print("Error: HTML element 'file-picker' not found!")
    except Exception as e:
        print(f"Error: {e}")


def js_fs_import(filename: str, uint8_array: "Uint8Array"):
    path = Path(filename)
    try:
        file_bytes = bytes(uint8_array)

        print(f"Successfully received file! Size: {len(file_bytes)} bytes")

        # Write to emscripten
        with open(path, "wb") as f:
            f.write(file_bytes)

        print(f"File saved to {path}")

        # with open(path, "r") as f:
        #     print(f.readlines())

    except Exception as e:
        print(f"Error processing file in Python: {e}")
