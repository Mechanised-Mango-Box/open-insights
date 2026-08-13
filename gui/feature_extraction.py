from utils import DatasetWhisperTranscript
from video_analysis.whisper_functions import transcribe_and_wordcount
from imgui_bundle import imgui
from universe import Universe
import whisper


def build_page(u: Universe):
    if imgui.begin_tab_bar("views", imgui.TabBarFlags_.none):
        if imgui.begin_tab_item("Transcript (Whisper)")[0]:
            if imgui.button("PLACEHOLDER - Apply to first without data"):
                for ent in u.entities:
                    if ent.ds_whisper_transcript:
                        print(f"Skipping: {ent}")
                        continue

                    # > Update
                    print(f"\n\nWhisper on {ent}")
                    path = ent.file_path
                    if path is None:
                        continue
                    whisper_res = whisper.transcribe(model=u.whisper_model, audio=str(path))
                    ent.ds_whisper_transcript = DatasetWhisperTranscript(
                        model_kind="tiny",
                        transcript=whisper_res["text"],
                        word_count=len(whisper_res["text"].split()),
                    )
                    print("Done")
                    break
            imgui.end_tab_item()

        if imgui.begin_tab_item("Scene Stats (OpenCV)")[0]:
            if imgui.button("PLACEHOLDER - APPLY TO ALL, OVERWRITE MODE"):
                for ent in u.entities:
                    # > Update
                    path = ent.file_path
                    if path is None:
                        continue
                    whisper_res = whisper.transcribe(model=u.whisper_model, audio=path)
                    ent.ds_whisper_transcript = DatasetWhisperTranscript(
                        model_kind="tiny",
                        transcript=whisper_res["text"],
                        word_count=len(whisper_res["text"].split()),
                    )

            imgui.end_tab_item()

        imgui.end_tab_bar()

    imgui.text("WIP - TABLE HERE")


def transcribe_and_wordcount(video_path: str, model) -> tuple[int, str]:

    # First we need to transcribe the video
    result = model.transcribe(video_path)  # returns a dictionary

    transcript: str = result["text"]  # this holds a string of all the text from the video

    # now we need to get the word count

    # to do this we need to split each word from the long string of text above
    word_count = len(transcript.split())

    return word_count, transcript
