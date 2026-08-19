from abc import ABC, abstractmethod
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Self

from typedef.video import Video
from utils import *


@dataclass(slots=True, kw_only=True)
class Dataset(ABC):
    @staticmethod
    @abstractmethod
    def get_label() -> str: ...

    @staticmethod
    @abstractmethod
    def get_label_display() -> str: ...

    @classmethod
    @abstractmethod
    def new_empty(cls) -> Self: ...

    @classmethod
    def get_fieldnames(cls) -> list[str]:
        return [field.name for field in fields(cls)]

    @classmethod
    @abstractmethod
    def export(cls, output_dir: Path, entities: list["Video"]): ...

    @abstractmethod
    def render_cell(self, element_id: str) -> None: ...

    @classmethod
    @abstractmethod
    def render_edit_menu(
        cls,
        element_id: str,
        just_activated: bool,
        original: Self | None,
        ptr_data: Ref[Self | None],
    ) -> Self | None: ...

