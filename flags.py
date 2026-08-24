import sys
from enum import IntEnum


class Platform(IntEnum):
    NATIVE = 0
    WEB = 1


PLATFORM: Platform = Platform.NATIVE
if sys.platform == "emscripten":
    PLATFORM = Platform.WEB
