from pathlib import Path

from typedef.dataset import *


class Universe:
    entities: list[Video] = []
    new_file_paths: list[Path] | None = None
