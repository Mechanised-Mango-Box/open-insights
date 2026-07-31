from dataclasses import dataclass
from typing import Generic, TypeVar, Union

#region Result types
T = TypeVar("T")
E = TypeVar("E")


@dataclass(frozen=True)
class Success(Generic[T]):
    value: T


@dataclass(frozen=True)
class Failure(Generic[E]):
    error: E


Result = Union[Success[T], Failure[E]]
#endregion

#region Custom type aliases
Path = str
CustomResourceType = str
ID = int
DatasetFileLabel = str
#endregion