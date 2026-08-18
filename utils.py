import csv
import hashlib
import io
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Generic, TypeVar

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
