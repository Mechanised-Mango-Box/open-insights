from pathlib import Path

from imgui_bundle import imgui

from typedef.dataset import (
    DatasetOpenCVSceneStats,
    DatasetTranscriptStats,
    DatasetWhisperTranscript,
    DatasetYoutubeAudienceRetention,
    DatasetYoutubeContent,
    Video,
)
from utils import *

__ptr_edit_menu_all_edit_youtube_content: Ref[DatasetYoutubeContent | None] = Ref(None)
__ptr_edit_menu_all_edit_youtube_audience_retention: Ref[
    DatasetYoutubeAudienceRetention | None
] = Ref(None)
__ptr_edit_menu_all_edit_whisper_transcript: Ref[DatasetWhisperTranscript | None] = Ref(
    None
)
__ptr_edit_menu_all_edit_transcript_stats: Ref[DatasetTranscriptStats | None] = Ref(None)
__ptr_edit_menu_all_edit_scene_stats: Ref[DatasetOpenCVSceneStats | None] = Ref(None)


def edit_menu_all(element_id: str, entity: Video, just_activated: bool):
    if just_activated:
        imgui.open_popup(element_id)
    if imgui.begin_popup_modal(
        element_id,
        None,
        imgui.WindowFlags_.no_saved_settings | imgui.WindowFlags_.always_auto_resize,
    )[0]:
        imgui.separator_text("General")
        _, entity.display_name = imgui.input_text(
            f"Display Name##{element_id}", entity.display_name
        )
        _, entity.file_hash = imgui.input_text(
            f"File Hash##{element_id}", e_str(entity.file_hash)
        )
        _, __new_path = imgui.input_text(
            f"File Path##{element_id}", e_str(entity.file_path)
        )
        if __new_path != "":
            entity.file_path = Path(__new_path)
        else:
            entity.file_path = None
        imgui.same_line()
        if imgui.button("WIP - Select Path"):
            print("BUTTON - SELECT PATH")
        imgui.separator_text("Datasets")

        entity.ds_yt_content = DatasetYoutubeContent.render_edit_menu(
            element_id + "/edit_menu_yt_content",
            imgui.button("Edit Youtube Content"),
            entity.ds_yt_content,
            __ptr_edit_menu_all_edit_youtube_content,
        )
        imgui.same_line()
        if entity.ds_yt_content:
            imgui.text(f"Content ID: {entity.ds_yt_content.content_id}")
        else:
            imgui.text("Not assigned")

        entity.ds_yt_audience_retention = (
            DatasetYoutubeAudienceRetention.render_edit_menu(
                element_id + "/edit_menu_yt_audience_retention",
                imgui.button("Edit Audience Retention"),
                (entity.ds_yt_audience_retention),
                __ptr_edit_menu_all_edit_youtube_audience_retention,
            )
        )
        imgui.same_line()
        if entity.ds_yt_audience_retention:
            imgui.text(
                f"Time Slice Counts: {len(entity.ds_yt_audience_retention.slices)}"
            )
        else:
            imgui.text("Not assigned")
        entity.ds_whisper_transcript = DatasetWhisperTranscript.render_edit_menu(
            element_id + "/edit_menu_whisper_transcript",
            imgui.button("Edit Transcript"),
            (entity.ds_whisper_transcript),
            __ptr_edit_menu_all_edit_whisper_transcript,
        )
        imgui.same_line()
        if entity.ds_whisper_transcript:
            imgui.text(f"Characters: {len(entity.ds_whisper_transcript.transcript)}")
        else:
            imgui.text("Not assigned")

        entity.ds_transcript_stats = DatasetTranscriptStats.render_edit_menu(
            element_id + "/edit_menu_transcript_stats",
            imgui.button("Edit Transcript Stats"),
            (entity.ds_transcript_stats),
            __ptr_edit_menu_all_edit_transcript_stats,
        )
        imgui.same_line()
        if entity.ds_transcript_stats:
            imgui.text(f"Word Count: {entity.ds_transcript_stats.word_count}")
        else:
            imgui.text("Not assigned")

        entity.ds_opencv_scene_stats = DatasetOpenCVSceneStats.render_edit_menu(
            element_id + "/edit_menu_scene_stats",
            imgui.button("Edit Scene Stats"),
            (entity.ds_opencv_scene_stats),
            __ptr_edit_menu_all_edit_scene_stats,
        )
        imgui.same_line()
        if entity.ds_opencv_scene_stats:
            imgui.text(
                f"Scene Count: {entity.ds_opencv_scene_stats.scene_transition_count}"
            )
        else:
            imgui.text("Not assigned")

        imgui.separator()
        if imgui.button("Close"):
            imgui.close_current_popup()
        imgui.end_popup()
