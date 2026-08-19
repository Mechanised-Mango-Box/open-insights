# pyrefly: ignore [missing-import]
from whisper import Whisper

from typedef.video import Video


class Universe:
    whisper_model: Whisper

    entities: list[Video] = []
