from uuid import UUID

import cv2  # pyrefly: ignore [missing-import]
from imgui_bundle import imgui

from gui.feature_extraction import count_scene_transitions, video_duration_mins
from typedef.dataset import (
    DatasetOpenCVSceneStats,
)
from universe import Universe
from utils import *


def tab_scenes_stats( selected_ids: set[UUID]):
    if imgui.button("Extract Scene Stats"):
        for entity in filter(lambda ent: ent._id in selected_ids, Universe.entities):
            # > Update
            print(f"\n\nOpenCV on {entity}")
            path = entity.file_path
            if path is None:
                print(f"\tSkipping, file not provided for: {entity._id}")
                continue

            video_capture = cv2.VideoCapture(str(path))
            # TODO
            match (
                video_duration_mins(video_capture),
                count_scene_transitions(video_capture),
            ):
                case (Success(duration), Success(scene_transition_count)):
                    entity.ds_opencv_scene_stats = DatasetOpenCVSceneStats(
                        duration_minutes=duration,
                        scene_transition_count=scene_transition_count,
                        scene_transition_rate=scene_transition_count / duration,
                    )
                case errs:
                    print(f"[ OpenCV ] Failed with errors: {errs}")
            print("[ OpenCV ] Releasing file handle.")
            video_capture.release()
        print("Done")
