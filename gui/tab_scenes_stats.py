from uuid import UUID

import cv2  # pyrefly: ignore [missing-import]
from imgui_bundle import imgui

from gui.feature_extraction import count_scene_transitions, video_duration_mins
from typedef.dataset import (
    DatasetOpenCVSceneStats,
)
from universe import Universe
from utils import Success


def tab_scenes_stats(selected_ids: set[UUID]):
    if imgui.button("Extract Scene Stats"):
        print(f"[ OpenCV ] Starting scene stat extraction ({len(selected_ids)} items)")
        for entity in filter(lambda ent: ent._id in selected_ids, Universe.entities):
            # > Update
            print(f"[ OpenCV ] Starting on {entity.display_name} ({entity._id})")
            path = entity.file_path
            if path is None:
                print(f"\tSkipping, file not provided for: {entity._id}")
                continue
            print("[ OpenCV ] Starting video capture.")
            video_capture = cv2.VideoCapture(str(path))
            print("[ OpenCV ] Counting scene transitions.")
            duration = video_duration_mins(video_capture)
            print("[ OpenCV ] Get video duration.")
            scene_transition_count = count_scene_transitions(video_capture)

            match (
                duration,
                scene_transition_count,
            ):
                case (Success(d), Success(stc)):
                    entity.ds_opencv_scene_stats = DatasetOpenCVSceneStats(
                        duration_minutes=d,
                        scene_transition_count=stc,
                        scene_transition_rate=stc / d,
                    )
                case errs:
                    print(f"[ OpenCV ] Failed with errors: {errs}")
            print("[ OpenCV ] Releasing file handle.")
            video_capture.release()
        print("Done")
