from uuid import UUID

import whisper  # pyrefly: ignore [missing-import]
from imgui_bundle import imgui

from typedef.dataset import (
    DatasetTranscriptStats,
    DatasetWhisperTranscript,
)
from universe import Universe
from utils import *


def tab_transcript(u: Universe, selected_ids: set[UUID]):
    if imgui.button("Extract Transcript"):
        for entity in filter(lambda ent: ent._id in selected_ids, u.entities):
            # > Update
            print(f"\n\nWhisper on {entity}")
            path = entity.file_path
            if path is None:
                print(f"\tSkipping, file not provided for: {entity._id}")
                continue

            whisper_res = whisper.transcribe(model=u.whisper_model, audio=str(path))
            entity.ds_whisper_transcript = DatasetWhisperTranscript(
                transcript=whisper_res["text"],
            )
        print("Done")

    if imgui.button("Calculate Transcript Stats"):
        for entity in filter(lambda ent: ent._id in selected_ids, u.entities):
            if not entity.ds_whisper_transcript:
                print(f"\tSkipping, no transcript: {entity._id}")
                continue

            # > Update
            print("\n\nProcessing transcript stats...")
            tscript = entity.ds_whisper_transcript
            entity.ds_transcript_stats = DatasetTranscriptStats(
                word_count=len(tscript.transcript.split()),
            )
        print("Done")
