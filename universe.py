from pathlib import Path

from typedef.video import Video


class Universe:
    entities: list[Video] = []
    new_file_paths: list[Path] = []
    new_file_uploaded: bool = False