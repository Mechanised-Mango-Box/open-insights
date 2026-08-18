from copy import deepcopy
from utils import *
import csv
from dataclasses import asdict
from imgui_bundle import imgui
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Self, override
from uuid import UUID

# > MARK: Custom type aliases
CustomResourceType = str
ID = int
DatasetFileLabel = str


# > MARK: Container Structs
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
    def export(cls, output_dir: Path, entities: list[Video]): ...

    @abstractmethod
    def render_cell(self, element_id: str) -> None: ...

    @classmethod
    @abstractmethod
    def render_edit_menu(
        cls,
        element_id: str,
        just_activated: bool,
        ptr_pre_snapshot: RefNullable[Self],
        ptr_data: RefNullable[Self],
    ): ...


@dataclass
class DatasetYoutubeContent(Dataset):
    yt_id: str | None
    title: str | None
    pub_time: str | None
    duration: int | None
    views: int | None
    watch_time: float | None
    subscribers: int | None
    average_view_duration: str | None
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
            yt_id=None,
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
            writer = csv.DictWriter(f, fieldnames=DatasetYoutubeContent.get_fieldnames())
            f.writelines("id,")
            writer.writeheader()
            for entity in entities:
                data = entity.ds_yt_content
                if not data:
                    continue
                f.writelines(str(entity._id) + ",")
                writer.writerow(asdict(data))
        print(f"[ Export ] Youtube Content export complete @ {yt_content_path}")

    @override
    def render_cell(self, element_id: str) -> None:
        imgui.text(e_str(self.yt_id))

    @classmethod
    @override
    def render_edit_menu(
        cls,
        element_id: str,
        just_activated: bool,
        ptr_pre_snapshot: RefNullable[DatasetYoutubeContent],
        ptr_data: RefNullable[DatasetYoutubeContent],
    ):
        if just_activated:
            ptr_data._ = (
                DatasetYoutubeContent.new_empty()
                if ptr_pre_snapshot._ is None
                else deepcopy(ptr_pre_snapshot._)
            )
            imgui.open_popup(element_id)
            return

        if imgui.begin_popup_modal(
            element_id,
            None,
            imgui.WindowFlags_.no_saved_settings | imgui.WindowFlags_.always_auto_resize,
        )[0]:
            assert ptr_data._
            imgui.input_text(f"Content ID##{element_id}", e_str(ptr_data._.yt_id))
            imgui.input_text(f"Duration##{element_id}", e_str(ptr_data._.duration))
            imgui.input_text(f"Title##{element_id}", e_str(ptr_data._.title))
            imgui.text("WIP")

            if imgui.button("Close"):
                ptr_data._ = None
                imgui.close_current_popup()

            imgui.end_popup()


@dataclass(slots=True, kw_only=True)
class DatasetYoutubeAudienceRetentionTimeslice:
    video_position: int
    absolute_audience_retention: float


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
        assert False

    @override
    def render_cell(self, element_id: str) -> None:
        imgui.text(str(self))

    @classmethod
    @override
    def render_edit_menu(
        cls,
        element_id: str,
        just_activated: bool,
        ptr_pre_snapshot: RefNullable[DatasetYoutubeAudienceRetention],
        ptr_data: RefNullable[DatasetYoutubeAudienceRetention],
    ):
        if just_activated:
            ptr_data._ = (
                DatasetYoutubeAudienceRetention.new_empty()
                if ptr_pre_snapshot._ is None
                else deepcopy(ptr_pre_snapshot._)
            )
            imgui.open_popup(element_id)
            return

        if imgui.begin_popup_modal(
            element_id,
            None,
            imgui.WindowFlags_.no_saved_settings | imgui.WindowFlags_.always_auto_resize,
        )[0]:
            assert ptr_data._
            imgui.input_text(f"Slices##{element_id}", e_str(ptr_data._.slices))
            imgui.text("WIP")

            if imgui.button("Close"):
                ptr_data._ = None
                imgui.close_current_popup()

            imgui.end_popup()


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
                f.writelines(whisper_transcript.transcript)

        print(f"[ Export ] Whisper Transcript export complete @ {transcript_dir}")

    @override
    def render_cell(self, element_id: str) -> None:
        imgui.text("Yes")

    @classmethod
    @override
    def render_edit_menu(
        cls,
        element_id: str,
        just_activated: bool,
        ptr_pre_snapshot: RefNullable[DatasetWhisperTranscript],
        ptr_data: RefNullable[DatasetWhisperTranscript],
    ):
        if just_activated:
            ptr_data._ = (
                DatasetWhisperTranscript.new_empty()
                if ptr_pre_snapshot._ is None
                else deepcopy(ptr_pre_snapshot._)
            )
            imgui.open_popup(element_id)
            return

        if imgui.begin_popup_modal(
            element_id,
            None,
            imgui.WindowFlags_.no_saved_settings | imgui.WindowFlags_.always_auto_resize,
        )[0]:
            assert ptr_data._
            imgui.input_text_multiline(f"Transcript##{element_id}", e_str(ptr_data._.transcript))
            imgui.text("WIP")

            if imgui.button("Close"):
                ptr_data._ = None
                imgui.close_current_popup()

            imgui.end_popup()


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
        assert False

    @override
    def render_cell(self, element_id: str) -> None:
        imgui.text("Yes")

    @classmethod
    @override
    def render_edit_menu(
        cls,
        element_id: str,
        just_activated: bool,
        ptr_pre_snapshot: RefNullable[DatasetTranscriptStats],
        ptr_data: RefNullable[DatasetTranscriptStats],
    ):
        if just_activated:
            ptr_data._ = (
                DatasetTranscriptStats.new_empty()
                if ptr_pre_snapshot._ is None
                else deepcopy(ptr_pre_snapshot._)
            )
            imgui.open_popup(element_id)
            return

        if imgui.begin_popup_modal(
            element_id,
            None,
            imgui.WindowFlags_.no_saved_settings | imgui.WindowFlags_.always_auto_resize,
        )[0]:
            assert ptr_data._
            imgui.input_int(f"Word Count##{element_id}", ptr_data._.word_count)
            imgui.text("WIP")

            if imgui.button("Close"):
                ptr_data._ = None
                imgui.close_current_popup()

            imgui.end_popup()


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
        assert False

    @override
    def render_cell(self, element_id: str) -> None:
        imgui.text(f"{self.scene_transition_count} scenes / {self.duration_minutes} mins")

    @classmethod
    @override
    def render_edit_menu(
        cls,
        element_id: str,
        just_activated: bool,
        ptr_pre_snapshot: RefNullable[DatasetOpenCVSceneStats],
        ptr_data: RefNullable[DatasetOpenCVSceneStats],
    ):
        if just_activated:
            ptr_data._ = (
                DatasetOpenCVSceneStats.new_empty()
                if ptr_pre_snapshot._ is None
                else deepcopy(ptr_pre_snapshot._)
            )
            imgui.open_popup(element_id)
            return

        if imgui.begin_popup_modal(
            element_id,
            None,
            imgui.WindowFlags_.no_saved_settings | imgui.WindowFlags_.always_auto_resize,
        )[0]:
            assert ptr_data._
            imgui.input_int(f"Transition Count ##{element_id}", ptr_data._.scene_transition_count)
            imgui.input_float(f"Duration (mins)##{element_id}", ptr_data._.duration_minutes)
            imgui.input_float(f"Transition Rate##{element_id}", ptr_data._.scene_transition_rate)
            imgui.text("WIP")

            if imgui.button("Close"):
                ptr_data._ = None
                imgui.close_current_popup()

            imgui.end_popup()


@dataclass(slots=True, kw_only=True)
class Video:
    _id: UUID

    # > File
    file_hash: str | None
    file_path: Path | None

    # > Display/Sorting
    display_name: str

    # > Datasets
    # > YT
    ds_yt_content: DatasetYoutubeContent | None = field(default=None, kw_only=True)
    ds_yt_audience_retention: DatasetYoutubeAudienceRetention | None = field(
        default=None, kw_only=True
    )
    # > Audio
    ds_whisper_transcript: DatasetWhisperTranscript | None = field(default=None, kw_only=True)
    ds_transcript_stats: DatasetTranscriptStats | None = field(default=None, kw_only=True)

    # > Video
    ds_opencv_scene_stats: DatasetOpenCVSceneStats | None = field(default=None, kw_only=True)
