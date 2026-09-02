import hashlib
from dataclasses import dataclass

# from enum import Enum, auto
from pathlib import Path
from typing import IO, Generic, TypeVar

# from imgui_bundle import portable_file_dialogs as pfd

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


def hash_stream(stream: IO[bytes], algo: str = "sha256", chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.new(algo)
    for chunk in iter(lambda: stream.read(chunk_size), b""):
        h.update(chunk)
    return h.hexdigest()


def file_hash(path: Path, algo: str = "sha256", chunk_size: int = 1024 * 1024) -> str:
    with open(path, "rb") as f:
        return hash_stream(f, algo, chunk_size)


# class Runtime(Enum):
#     NATIVE = auto()
#     WEB = auto()


# def file_select(runtime: Runtime) -> Result[list, str]:
#     match runtime:
#         case Runtime.NATIVE:
#             selection = pfd.open_file(
#                 "Upload Youtube Content Report...",
#                 ".",
#                 ["Youtube Content Report (CSV)", "*.csv"],
#                 options=pfd.opt.none,
#             ).result()
