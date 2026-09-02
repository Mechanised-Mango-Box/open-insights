import csv
from abc import ABC, abstractmethod
from copy import deepcopy
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Self, override

from imgui_bundle import imgui

from typedef.video import Video
from utils import *


@dataclass(slots=True, kw_only=True)
class Dataset(ABC):
    @staticmethod
    @abstractmethod
    def get_label() -> str: ...

    @staticmethod
    @abstractmethod
    def get_label_display() -> str: ...

    @classmethod
    @abstractmethod
    def new_empty(cls) -> Self: ...

    @classmethod
    def get_fieldnames(cls) -> list[str]:
        return [field.name for field in fields(cls)]

    @classmethod
    @abstractmethod
    def export(cls, output_dir: Path, entities: list["Video"]): ...

    @abstractmethod
    def render_cell(self, element_id: str) -> None: ...

    @classmethod
    @abstractmethod
    def render_edit_menu(
        cls,
        element_id: str,
        just_activated: bool,
        original: Self | None,
        ptr_data: Ref[Self | None],
    ) -> Self | None: ...


# > MARK: Youtube Content
@dataclass
class DatasetYoutubeContent(Dataset):
    content_id: str | None
    title: str | None
    pub_time: str | None
    duration: int | None
    views: int | None
    watch_time: float | None
    subscribers: int | None
    average_view_duration: float | None
    impressions: int | None
    impressions_click_through_rate: float | None

    @staticmethod
    @override
    def get_label():
        return "yt_content"

    @staticmethod
    @override
    def get_label_display():
        return "Youtube Content"

    @classmethod
    @override
    def new_empty(cls):
        return DatasetYoutubeContent(
            content_id=None,
            title=None,
            pub_time=None,
            duration=None,
            views=None,
            watch_time=None,
            subscribers=None,
            average_view_duration=None,
            impressions=None,
            impressions_click_through_rate=None,
        )

    @classmethod
    @override
    def export(cls, output_dir: Path, entities: list[Video]):
        print("[ Export ] Generating: Youtube Content...")
        yt_content_path = output_dir / (DatasetYoutubeContent.get_label() + ".csv")
        with yt_content_path.open("w") as f:
            writer = csv.DictWriter(
                f, fieldnames=DatasetYoutubeContent.get_fieldnames()
            )
            f.write("id,")
            writer.writeheader()
            for entity in entities:
                data = entity.ds_yt_content
                if not data:
                    continue
                f.write(str(entity._id) + ",")
                writer.writerow(asdict(data))
        print(f"[ Export ] Youtube Content export complete @ {yt_content_path}")

    @override
    def render_cell(self, element_id: str) -> None:
        imgui.text(e_str(self.content_id))

    @classmethod
    @override
    def render_edit_menu(
        cls,
        element_id,
        just_activated,
        original,
        ptr_data,
    ):
        if just_activated:
            ptr_data._ = (
                DatasetYoutubeContent.new_empty()
                if original is None
                else deepcopy(original)
            )
            imgui.open_popup(element_id)

        if imgui.begin_popup_modal(
            element_id,
            None,
            imgui.WindowFlags_.no_saved_settings
            | imgui.WindowFlags_.always_auto_resize,
        )[0]:
            assert ptr_data._
            _, ptr_data._.content_id = imgui.input_text(
                f"Content ID##{element_id}", e_str(ptr_data._.content_id)
            )
            _, ptr_data._.duration = imgui.input_int(
                f"Duration (mins)##{element_id}", ptr_data._.duration or 0
            )
            _, ptr_data._.title = imgui.input_text(
                f"Title##{element_id}", e_str(ptr_data._.title)
            )
            imgui.text("WIP")

            imgui.separator()
            if imgui.button("Save" if original else "Create"):
                imgui.close_current_popup()
                imgui.end_popup()
                return ptr_data._
            imgui.same_line()
            if imgui.button("Cancel"):
                ptr_data._ = None
                imgui.close_current_popup()
                imgui.end_popup()
                return original

            imgui.end_popup()
        return original


@dataclass(slots=True, kw_only=True)
class DatasetYoutubeAudienceRetentionTimeslice:
    video_position: int
    absolute_audience_retention: float


# > MARK: Youtube Audience Retention
@dataclass
class DatasetYoutubeAudienceRetention(Dataset):
    slices: list[DatasetYoutubeAudienceRetentionTimeslice]

    @staticmethod
    @override
    def get_label():
        return "yt_audience_retention"

    @staticmethod
    @override
    def get_label_display():
        return "Youtube Audience Retention"

    @classmethod
    @override
    def new_empty(cls):
        return DatasetYoutubeAudienceRetention(slices=[])

    @classmethod
    @override
    def export(cls, output_dir: Path, entities: list[Video]):
        print("[ Export ] Generating: Youtube Audience Retention...")
        path = output_dir / (DatasetYoutubeAudienceRetention.get_label() + ".csv")
        with path.open("w") as f:
            writer = csv.DictWriter(
                f, fieldnames=DatasetYoutubeAudienceRetention.get_fieldnames()
            )
            f.write("id,")
            writer.writeheader()
            for entity in entities:
                data = entity.ds_yt_audience_retention
                if not data:
                    continue
                f.write(str(entity._id) + ",")
                writer.writerow(asdict(data))
        print(f"[ Export ] Youtube Audience Retention export complete @ {path}")

    @override
    def render_cell(self, element_id: str) -> None:
        imgui.text(str(self))

    @classmethod
    @override
    def render_edit_menu(
        cls,
        element_id,
        just_activated,
        original,
        ptr_data,
    ):
        if just_activated:
            ptr_data._ = (
                DatasetYoutubeAudienceRetention.new_empty()
                if original is None
                else deepcopy(original)
            )
            imgui.open_popup(element_id)

        if imgui.begin_popup_modal(
            element_id,
            None,
            imgui.WindowFlags_.no_saved_settings
            | imgui.WindowFlags_.always_auto_resize,
        )[0]:
            assert ptr_data._
            imgui.input_text(f"Slices##{element_id}", e_str(ptr_data._.slices))
            imgui.text("WIP")

            imgui.separator()
            if imgui.button("Save" if original else "Create"):
                imgui.close_current_popup()
                imgui.end_popup()
                return ptr_data._
            imgui.same_line()
            if imgui.button("Cancel"):
                ptr_data._ = None
                imgui.close_current_popup()
                imgui.end_popup()
                return original

            imgui.end_popup()
        return original


# > MARK: Whisper Transcript
@dataclass
class DatasetWhisperTranscript(Dataset):
    transcript: str

    @staticmethod
    @override
    def get_label():
        return "whisper_transcript"

    @staticmethod
    @override
    def get_label_display():
        return "Whisper Transcript"

    @classmethod
    @override
    def new_empty(cls):
        return DatasetWhisperTranscript(transcript="")

    @classmethod
    @override
    def export(cls, output_dir: Path, entities: list[Video]):
        print("[ Export ] Generating: Whisper ranscript...")

        print("[ Export ] Generating folder...")
        transcript_dir = output_dir / DatasetWhisperTranscript.get_label()
        transcript_dir.mkdir()
        print(f"[ Export ] Folder: {transcript_dir}")
        for entity in entities:
            whisper_transcript = entity.ds_whisper_transcript
            if not whisper_transcript:
                continue

            print(f"[ Export ] Exporting transcript for {entity._id}")

            curr_file_path = transcript_dir / (str(entity._id) + ".txt")
            with curr_file_path.open("w") as f:
                f.write(whisper_transcript.transcript)

        print(f"[ Export ] Whisper Transcript export complete @ {transcript_dir}")

    @override
    def render_cell(self, element_id: str) -> None:
        imgui.text("Yes")

    @classmethod
    @override
    def render_edit_menu(
        cls,
        element_id,
        just_activated,
        original,
        ptr_data,
    ):
        if just_activated:
            ptr_data._ = (
                DatasetWhisperTranscript.new_empty()
                if original is None
                else deepcopy(original)
            )
            imgui.open_popup(element_id)

        if imgui.begin_popup_modal(
            element_id,
            None,
            imgui.WindowFlags_.no_saved_settings
            | imgui.WindowFlags_.always_auto_resize,
        )[0]:
            assert ptr_data._
            just_changed, text = imgui.input_text_multiline(
                f"Transcript##{element_id}", ptr_data._.transcript
            )

            if just_changed:
                ptr_data._.transcript = text

            imgui.separator()
            if imgui.button("Save" if original else "Create"):
                imgui.close_current_popup()
                imgui.end_popup()
                return ptr_data._
            imgui.same_line()
            if imgui.button("Cancel"):
                ptr_data._ = None
                imgui.close_current_popup()
                imgui.end_popup()
                return original

            imgui.end_popup()
        return original


# > MARK: Transcript Stats
@dataclass(slots=True, kw_only=True)
class DatasetTranscriptStats(Dataset):
    word_count: int

    @staticmethod
    @override
    def get_label():
        return "transcript_stats"

    @staticmethod
    @override
    def get_label_display():
        return "Transcript Stats"

    @classmethod
    @override
    def new_empty(cls):
        return DatasetTranscriptStats(word_count=0)

    @classmethod
    @override
    def export(cls, output_dir: Path, entities: list[Video]):
        print("[ Export ] Generating: Transcript Stats...")
        path = output_dir / (DatasetTranscriptStats.get_label() + ".csv")
        with path.open("w") as f:
            writer = csv.DictWriter(
                f, fieldnames=DatasetTranscriptStats.get_fieldnames()
            )
            f.write("id,")
            writer.writeheader()
            for entity in entities:
                data = entity.ds_transcript_stats
                if not data:
                    continue
                f.write(str(entity._id) + ",")
                writer.writerow(asdict(data))
        print(f"[ Export ] Transcript Stats export complete @ {path}")

    @override
    def render_cell(self, element_id: str) -> None:
        imgui.text("Yes")

    @classmethod
    @override
    def render_edit_menu(
        cls,
        element_id,
        just_activated,
        original,
        ptr_data,
    ):
        if just_activated:
            ptr_data._ = (
                DatasetTranscriptStats.new_empty()
                if original is None
                else deepcopy(original)
            )
            imgui.open_popup(element_id)

        if imgui.begin_popup_modal(
            element_id,
            None,
            imgui.WindowFlags_.no_saved_settings
            | imgui.WindowFlags_.always_auto_resize,
        )[0]:
            assert ptr_data._
            _, ptr_data._.word_count = imgui.input_int(
                f"Word Count##{element_id}", ptr_data._.word_count
            )
            imgui.text("WIP")

            imgui.separator()
            if imgui.button("Save" if original else "Create"):
                imgui.close_current_popup()
                imgui.end_popup()
                return ptr_data._
            imgui.same_line()
            if imgui.button("Cancel"):
                ptr_data._ = None
                imgui.close_current_popup()
                imgui.end_popup()
                return original

            imgui.end_popup()
        return original


# > MARK: OpenCV Scene Stats
@dataclass(slots=True, kw_only=True)
class DatasetOpenCVSceneStats(Dataset):
    duration_minutes: float
    scene_transition_count: int
    scene_transition_rate: float

    @staticmethod
    @override
    def get_label():
        return "opencv_scene_stats"

    @staticmethod
    @override
    def get_label_display():
        return "OpenCV Scene Stats"

    @classmethod
    @override
    def new_empty(cls):
        return DatasetOpenCVSceneStats(
            duration_minutes=0, scene_transition_count=0, scene_transition_rate=0
        )

    @classmethod
    @override
    def export(cls, output_dir: Path, entities: list[Video]):
        print("[ Export ] Generating: OpenCV Scene Stats...")
        path = output_dir / (DatasetOpenCVSceneStats.get_label() + ".csv")
        with path.open("w") as f:
            writer = csv.DictWriter(
                f, fieldnames=DatasetOpenCVSceneStats.get_fieldnames()
            )
            f.write("id,")
            writer.writeheader()
            for entity in entities:
                data = entity.ds_opencv_scene_stats
                if not data:
                    continue
                f.write(str(entity._id) + ",")
                writer.writerow(asdict(data))
        print(f"[ Export ] OpenCV Scene Stats export complete @ {path}")

    @override
    def render_cell(self, element_id: str) -> None:
        imgui.text(
            f"{self.scene_transition_count} scenes / {round(self.duration_minutes, 2)} mins"
        )

    @classmethod
    @override
    def render_edit_menu(
        cls,
        element_id,
        just_activated,
        original,
        ptr_data,
    ):
        if just_activated:
            ptr_data._ = (
                DatasetOpenCVSceneStats.new_empty()
                if original is None
                else deepcopy(original)
            )
            imgui.open_popup(element_id)

        if imgui.begin_popup_modal(
            element_id,
            None,
            imgui.WindowFlags_.no_saved_settings
            | imgui.WindowFlags_.always_auto_resize,
        )[0]:
            assert ptr_data._
            _, ptr_data._.scene_transition_count = imgui.input_int(
                f"Transition Count ##{element_id}", ptr_data._.scene_transition_count
            )
            _, ptr_data._.duration_minutes = imgui.input_float(
                f"Duration (mins)##{element_id}", ptr_data._.duration_minutes
            )
            _, ptr_data._.scene_transition_rate = imgui.input_float(
                f"Transition Rate##{element_id}", ptr_data._.scene_transition_rate
            )
            imgui.text("WIP")

            imgui.separator()
            if imgui.button("Save" if original else "Create"):
                imgui.close_current_popup()
                imgui.end_popup()
                return ptr_data._
            imgui.same_line()
            if imgui.button("Cancel"):
                ptr_data._ = None
                imgui.close_current_popup()
                imgui.end_popup()
                return original

            imgui.end_popup()
        return original


ALL_DATASETS = [
    DatasetYoutubeContent,
    DatasetYoutubeAudienceRetention,
    DatasetWhisperTranscript,
    DatasetTranscriptStats,
    DatasetOpenCVSceneStats,
]
