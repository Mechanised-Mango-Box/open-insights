import whisper
import pandas as pd


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




def extract_whisper_features(video_path: str) -> dict:

    word_count, transcript = transcribe_and_wordcount(video_path, model)

    metrics = {
        "word_count": word_count,
        "transcript": transcript
    }

    return metrics

def save_whisper_csv(metrics: dict, filename: str):

    df = pd.DataFrame([metrics])

    df.to_csv(filename, index=False)