import whisper
from collections import list
import cv2


# example 
# import whisper

# model = whisper.load_model("base")
# result = model.transcribe("audio.mp3")
# print(result["text"])


""""

Whisper is an open source automatic speech recognition (SAR) system used to transcribe and translate spoken audio into text, often integrated 
with CV (Computer Vision) and video processing workflows for automated subtitling or multimedia analysis.

How this will be useful for our Project?
    - Be able to transcribe lecture videos into text.
    - Be able to get the word count of a video. 

"""

# this it to load up the whisper model
model = whisper.load_model("turbo")

def transcribe_and_wordcount(video_path: str, model) -> tuple[int, str]:

    # First we need to transcribe the video
    result = model.transcribe(video_path) # returns a dictionary

    transcript: str = result["text"] # this holds a string of all the text from the video

    # now we need to get the word count

    # to do this we need to split each word from the long string of text above 
    word_count = len(transcript.split())

    return word_count, transcript

# next function we need is to get the video duration 
# to get this we need to use a tool called open cv which is a computer vision Tool used to analsye images, video analysis, and more.
def video_duration_mins(video_path: str) -> float:
   
    video_capture = cv2.VideoCapture(video_path) # this just asks opencv to open the video file 

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
    video_capture = cv2.VideoCapture(video_path)

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
