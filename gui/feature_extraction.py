# pyrefly: ignore [missing-import]
import cv2

# pyrefly: ignore [missing-import]
import whisper
from imgui_bundle import imgui

from typedef import (
    DatasetOpenCVSceneStats,
    DatasetTranscriptStats,
    DatasetWhisperTranscript,
)
from universe import Universe
from utils import *


def build_page(u: Universe):
    if imgui.begin_tab_bar("views", imgui.TabBarFlags_.none):
        if imgui.begin_tab_item("Transcript (Whisper)")[0]:
            if imgui.button(
                "Extract Transcript (PLACEHOLDER) - Apply to first without data"
            ):
                for ent in u.entities:
                    if ent.ds_whisper_transcript:
                        print(f"Skipping: {ent}")
                        continue

                    # > Update
                    print(f"\n\nWhisper on {ent}")
                    path = ent.file_path
                    if path is None:
                        continue

                    whisper_res = whisper.transcribe(
                        model=u.whisper_model, audio=str(path)
                    )
                    ent.ds_whisper_transcript = DatasetWhisperTranscript(
                        transcript=whisper_res["text"],
                    )
                    print("Done")
                    break
            if imgui.button(
                "Process Transcript Stats (PLACEHOLDER) - Apply to first without data"
            ):
                for ent in u.entities:
                    if ent.ds_transcript_stats or not ent.ds_whisper_transcript:
                        print(f"Skipping: {ent}")
                        continue

                    # > Update
                    print("\n\nProcessing transcript stats...")
                    tscript = ent.ds_whisper_transcript
                    ent.ds_transcript_stats = DatasetTranscriptStats(
                        word_count=len(tscript.transcript.split()),
                    )
                    print("Done")
                    break
            imgui.end_tab_item()

        if imgui.begin_tab_item("Scene Stats (OpenCV)")[0]:
            if imgui.button("PLACEHOLDER - Apply to first without data"):
                for ent in u.entities:
                    if ent.ds_opencv_scene_stats:
                        print(f"Skipping: {ent}")
                        continue

                    # > Update
                    print(f"\n\nOpenCV on {ent}")
                    path = ent.file_path
                    if path is None:
                        continue

                    video_capture = cv2.VideoCapture(str(path))
                    # TODO
                    match (
                        video_duration_mins(video_capture),
                        count_scene_transitions(video_capture),
                    ):
                        case (Success(duration), Success(scene_transition_count)):
                            ent.ds_opencv_scene_stats = DatasetOpenCVSceneStats(
                                duration_minutes=duration,
                                scene_transition_count=scene_transition_count,
                                scene_transition_rate=scene_transition_count / duration,
                            )
                        case errs:
                            print(f"[ OpenCV ] Failed with errors: {errs}")
                    print("[ OpenCV ] Releasing file handle.")
                    video_capture.release()
                    print("Done")
                    break
            imgui.end_tab_item()
        imgui.end_tab_bar()

    imgui.text("WIP - TABLE HERE")


# next function we need is to get the video duration
# to get this we need to use a tool called open cv which is a computer vision Tool used to analsye images, video analysis, and more.
def video_duration_mins(video_capture: cv2.VideoCapture) -> Result[float, str]:
    # check if the file has opened
    if not video_capture.isOpened():
        return Failure(f"Failed to open video file: {video_capture}")

    # get the frames per second property
    fps = video_capture.get(cv2.CAP_PROP_FPS)

    # get totatl frames in video
    total_frames = video_capture.get(cv2.CAP_PROP_FRAME_COUNT)

    duration = (total_frames / fps) / 60  # in mins
    return Success(duration)


# Open CV only lets you or gives you the tools to analyse frames/images, we have to write our own algorithm to define what a change in scene is.
# VideoCapture.read() returns two values which are, success and frame, a boolean and an array of pixel data.
def count_scene_transitions(
    video_capture: cv2.VideoCapture, threshold: float = 30.0
) -> Result[int, str]:
    if not video_capture.isOpened():
        return Failure(f"Failed to open video file: {video_capture}")

    transition_count = 0
    previous_frame = None

    while True:
        success, frame = video_capture.read()

        if not success:
            break

        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if previous_frame is not None:
            difference = cv2.absdiff(previous_frame, gray_frame)

            mean_difference = difference.mean()

            if mean_difference > threshold:
                transition_count += 1

        previous_frame = gray_frame

    return Success(transition_count)
