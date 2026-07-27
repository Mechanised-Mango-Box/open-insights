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
def video_duration(video_path: str) -> float:
   
    video_capture = cv2.VideoCapture(video_path) # this just asks opencv to open the video file 

    # check if the file has opened
    if video_capture.isOpened():
        #get the frames per second property
        fps = video_capture.get(cv2.CAP_PROP_FPS)

        # get totatl frames in video
        total_frames = video_capture.get(cv2.CAP_PROP_FRAME_COUNT)

        duration = (total_frames/fps) / 60 # in mins

        return duration 


    else:
        return ("VIDEO FILE WASN'T ABLE TO BE OPENED")

   



def word_per_min():
    pass

def count_scene_transitions():

    pass




