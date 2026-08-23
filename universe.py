from typedef.video import Video
from utils import Runtime


class Universe:
    runtime: Runtime = Runtime.WEB
    entities: list[Video] = []
