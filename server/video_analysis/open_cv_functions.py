from collections import list
import cv2
import pandas as pd

video_capture = cv2.VideoCapture(video_path) # this just asks opencv to open the video file 

# next function we need is to get the video duration 
# to get this we need to use a tool called open cv which is a computer vision Tool used to analsye images, video analysis, and more.
def video_duration_mins(video_path: str) -> float:
   
    
    # check if the file has opened
    if video_capture.isOpened():
        #get the frames per second property
        fps = video_capture.get(cv2.CAP_PROP_FPS)

        # get totatl frames in video
        total_frames = video_capture.get(cv2.CAP_PROP_FRAME_COUNT)

        duration = (total_frames/fps) / 60 # in mins
        video_capture.release() #frees the resources OPENCV is using
        return duration 


    else:
        raise ValueError ("VIDEO FILE WASN'T ABLE TO BE OPENED")

   

def word_per_min(word_count: int, video_duration: float) -> float:
    wpm = word_count / video_duration 
    print ("WPM: ", wpm)
    return wpm 

 # Open CV only lets you or gives you the tools to analyse frames/images, we have to write our own algorithm to define what a change in scene is. 
# VideoCapture.read() returns two values which are, success and frame, a boolean and an array of pixel data.
def count_scene_transitions(video_path: str, threshold: float = 30.0) -> int:


    if not video_capture.isOpened():
        raise ValueError("Video file could not be opened")

    transition_count = 0
    previous_frame = None

    while True:
        success, frame = video_capture.read()

        if not success:
            break

        gray_frame = cv2.cvtColor(
            frame,
            cv2.COLOR_BGR2GRAY
        )

        if previous_frame is not None:
            difference = cv2.absdiff(
                previous_frame,
                gray_frame
            )

            mean_difference = difference.mean()

            if mean_difference > threshold:
                transition_count += 1

        previous_frame = gray_frame

    video_capture.release()

    return transition_count


    # this can have errors as it could count camera movement, brightness change and cursor movements as a scene transition, so have to test first
    # and make changes in percentage of pixel changes later if needed.



def extract_opencv_features(video_path: str) -> dict:
    """
    Runs all OpenCV feature functions and returns their metrics
    in a single dictionary.
    """

    duration_minutes = video_duration_mins(video_path)

    scene_transition_count = count_scene_transitions(
        video_path
    )

    if duration_minutes > 0:
        scene_transitions_per_minute = (
            scene_transition_count / duration_minutes
        )
    else:
        scene_transitions_per_minute = 0.0

    return {
        "duration_minutes": round(duration_minutes, 4),
        "scene_transition_count": scene_transition_count,
        "scene_transitions_per_minute": round(
            scene_transitions_per_minute,
            2
        ),
    }

def extract_opencv_features(video_path: str) -> dict:

    duration = video_duration_mins(video_path)

    transitions = count_scene_transitions(video_path)

    rate = transitions / duration

    metrics = {
        "duration_minutes": duration,
        "scene_transition_count": transitions,
        "scene_transition_rate": rate
    }

    return metrics


def save_opencv_csv(metrics: dict, filename: str):

    df = pd.DataFrame([metrics])

    df.to_csv(filename, index=False)


if __name__ == "__main__":
    video_path = "lecture.mp4"

    metrics = extract_opencv_features(video_path)

    print(metrics)