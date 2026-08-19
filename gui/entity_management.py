import csv
from enum import Enum, auto
from pathlib import Path
from uuid import UUID, uuid4

# pyrefly: ignore [missing-import]
import cv2

# pyrefly: ignore [missing-import]
import whisper
from imgui_bundle import imgui
from imgui_bundle import portable_file_dialogs as pfd

from export import export_selection
from gui.edit_menu_all import edit_menu_all
from gui.feature_extraction import count_scene_transitions, video_duration_mins
from typedef.dataset import (
    ALL_DATASETS,
    DatasetOpenCVSceneStats,
    DatasetTranscriptStats,
    DatasetWhisperTranscript,
    DatasetYoutubeAudienceRetention,
    DatasetYoutubeContent,
)
from typedef.video import Video
from universe import Universe
from utils import *


class TableSelectMode(Enum):
    NONE = auto()
    SINGLE = auto()
    MULTIPLE = auto()


__selected_ids: set[UUID] = set()


# > MARK: SECTION: Import / Export
def tab_import_export(u: Universe, selected_ids: set[UUID]):
    # > YT Content
    if imgui.button("Import from: Youtube Content"):
        selection = pfd.open_file(
            "Upload Youtube Content Report...",
            ".",
            ["Youtube Content Report (CSV)", "*.csv"],
            options=pfd.opt.none,
        ).result()
        assert len(selection) <= 1

        if len(selection) == 0:
            print("No file selected.")
        else:
            path = selection[0]

            upsert_yt_content_csv(path, u.entities)
            print(u.entities)
    # > Video
    if imgui.button("Import from: Video File"):
        selection = pfd.open_file(
            "Upload Video(s)...",
            ".",
            ["Video(s)", "*.mp4"],
            options=pfd.opt.multiselect,
        ).result()

        if len(selection) == 0:
            print("No file selected.")
        else:
            for str_path in selection:
                path = Path(str_path)
                selected_hash = file_hash(path)

                def is_same_hash(entity: Video, other_hash: str):
                    if not entity.file_hash:
                        return False
                    return entity.file_hash == other_hash

                print(selected_hash)
                matching = list(
                    filter(
                        lambda entity: is_same_hash(entity, selected_hash),
                        u.entities,
                    )
                )
                print(matching)

                if len(matching) <= 0:
                    # * None match, insert new
                    new_entity = Video(
                        _id=uuid4(),
                        file_hash=selected_hash,
                        file_path=path,
                        display_name=path.stem,
                    )  # TODO make file the name not the whole path
                    u.entities.append(new_entity)
                else:
                    # * Update
                    for matching_entity in matching:
                        print("MATCH", matching_entity)


def tab_transcript(u: Universe, selected_ids: set[UUID]):
    if imgui.button("Extract Transcript"):
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
                transcript=whisper_res["text"],
            )
            print("Done")
            break
    if imgui.button("Calculate Transcript Stats"):
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


def tab_scenes_stats(u: Universe, selected_ids: set[UUID]):
    if imgui.button("Extract Scene Stats"):
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


def build_page(u: Universe):
    global __selected_ids
    if imgui.begin_tab_bar("Entity Actions", imgui.TabBarFlags_.none):
        if imgui.begin_tab_item("Import / Export")[0]:
            tab_import_export(u, __selected_ids)
            imgui.end_tab_item()

        # > MARK: SECTION: Feature Extraction
        if imgui.begin_tab_item("Transcript (Whisper)")[0]:
            tab_transcript(u, __selected_ids)
            imgui.end_tab_item()

        if imgui.begin_tab_item("Scene Stats (OpenCV)")[0]:
            tab_scenes_stats(u, __selected_ids)
            imgui.end_tab_item()
        imgui.end_tab_bar()
    # > MARK: SECTION: Selection Actions
    imgui.separator_text("Selection")
    if imgui.button("Select All"):
        __selected_ids |= {ent._id for ent in u.entities}
    imgui.same_line()
    if imgui.button("Deselect All"):
        __selected_ids.clear()
    imgui.same_line()
    if imgui.button("Invert Selection"):
        __selected_ids = {ent._id for ent in u.entities} ^ __selected_ids
    imgui.same_line()
    imgui.input_text("Filter", "")

    imgui.text(f"Selected: {len(__selected_ids)}")
    imgui.same_line()
    if len(__selected_ids) < 2:
        imgui.begin_disabled()
    if imgui.button("Merge"):
        ...
    imgui.same_line()
    if len(__selected_ids) < 2:
        imgui.end_disabled()

    if len(__selected_ids) < 1:
        imgui.begin_disabled()

    if imgui.button("Export"):
        out_dir = pfd.select_folder(
            "Select export location...",
            ".",
            options=pfd.opt.none,
        ).result()
        _ = export_selection(Path(out_dir), u.entities)
    imgui.same_line()

    DELETE_ROW_ID = "Delete Items##delete_row"
    if imgui.button("Delete"):
        imgui.open_popup(DELETE_ROW_ID)
    if len(__selected_ids) < 1:
        imgui.end_disabled()
    if imgui.begin_popup_modal(
        DELETE_ROW_ID,
        None,
        imgui.WindowFlags_.no_saved_settings | imgui.WindowFlags_.always_auto_resize,
    )[0]:
        imgui.text(f"Are you sure you want to delete {len(__selected_ids)} items?")

        imgui.separator()
        if imgui.button("Confirm"):
            imgui.close_current_popup()
            u.entities = list(filter(lambda ent: ent._id in __selected_ids, u.entities))
            __selected_ids.clear()
        imgui.same_line()
        if imgui.button("Cancel"):
            imgui.close_current_popup()
        imgui.end_popup()

    # > MARK: SECTION Table
    element_id: str = "entity_table"
    # * Rows
    rows = u.entities
    # column_flags: List[int],
    # on_update_row: Callable[[None], None],
    # * Selection
    selected_ids: set[UUID] = __selected_ids
    table_select_mode: TableSelectMode = TableSelectMode.MULTIPLE
    # * Events
    on_double_click = edit_menu_all

    show_select_box = table_select_mode is not TableSelectMode.NONE

    table_flags = (
        imgui.TableFlags_.borders
        | imgui.TableFlags_.row_bg
        | imgui.TableFlags_.resizable
        | imgui.TableFlags_.sort_tristate
        | imgui.TableFlags_.sort_multi
        | imgui.TableFlags_.sortable
    )

    # > Construct Table
    if imgui.begin_table(element_id, 9 + (1 if show_select_box else 0), table_flags):
        # > Generate Headers
        if show_select_box:
            imgui.table_setup_column(
                "",
                imgui.TableColumnFlags_.no_sort
                | imgui.TableColumnFlags_.no_resize
                | imgui.TableColumnFlags_.width_fixed,
            )

        imgui.table_setup_column("ID")
        imgui.table_setup_column("Title")
        imgui.table_setup_column("File Hash")
        imgui.table_setup_column("File Handle")
        for DS in ALL_DATASETS:
            imgui.table_setup_column(DS.get_label_display())
        imgui.table_headers_row()

        for row in rows:
            imgui.table_next_row()
            in_selected = row._id in selected_ids
            if show_select_box:
                imgui.table_next_column()

                clicked_checkbox, _ = imgui.checkbox(
                    f"##{element_id}/checkboxes/{row._id}", in_selected
                )
                if clicked_checkbox:
                    if in_selected:
                        selected_ids.remove(row._id)
                    else:
                        if table_select_mode is not TableSelectMode.MULTIPLE:
                            # ? if single select, always clear selection
                            selected_ids.clear()
                        selected_ids.add(row._id)

            imgui.table_next_column()
            _, _ = imgui.selectable(
                f"{row._id}##{element_id}/rows/{row._id}",
                in_selected,
                # imgui.SelectableFlags_.span_all_columns
                # |
                imgui.SelectableFlags_.no_auto_close_popups,
            )

            if on_double_click is not None:
                on_double_click(
                    f"Edit##{row._id}/edit_menu_all",
                    row,
                    imgui.is_item_hovered() and imgui.is_mouse_double_clicked(0),
                )
            imgui.table_next_column()

            imgui.set_next_item_width(-imgui.FLT_MIN)
            imgui.input_text(
                f"##{row._id}/display_name",
                row.display_name,
                imgui.InputTextFlags_.read_only,
            )
            imgui.table_next_column()

            if row.file_hash:
                imgui.text(row.file_hash)
            else:
                imgui.text("")
            imgui.table_next_column()

            if row.file_path:
                imgui.text(row.file_path.name)
            else:
                imgui.text("")

            for ds in [
                row.ds_yt_content,
                row.ds_yt_audience_retention,
                row.ds_whisper_transcript,
                row.ds_transcript_stats,
                row.ds_opencv_scene_stats,
            ]:
                imgui.table_next_column()

                if ds:
                    ds.render_cell(f"##{row._id}/{ds.get_label()}")
                else:
                    imgui.text("")
    imgui.end_table()


def upsert_yt_content_csv(path: str, ptr_entities: list[Video]):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)  # columns become dict keys
        for row in reader:
            # > Read as obj
            obj = DatasetYoutubeContent(
                content_id=row["Content"],
                title=row["Video title"],
                pub_time=row["Video publish time"],
                duration=int(row["Duration"]),
                views=int(row["Views"]),
                watch_time=float(row["Watch time (hours)"]),
                subscribers=int(row["Subscribers"]),
                average_view_duration=row["Average view duration"],
                impressions=int(row["Impressions"]),
                impressions_click_through_rate=(
                    float(x)
                    if (x := row["Impressions click-through rate (%)"]) is not None
                    and ""
                    else None
                ),
            )

            # >  Insert into universe
            has_repalced_existing = False
            for entity in ptr_entities:
                # > Same ID -> replace
                if (
                    entity.ds_yt_content
                    and entity.ds_yt_content.content_id == obj.content_id
                ):
                    entity.ds_yt_content = obj
                    has_repalced_existing = True
                    break

            if not has_repalced_existing:
                new_entity = Video(
                    _id=uuid4(),
                    file_hash=None,
                    file_path=None,
                    display_name=e_str(obj.title),
                    ds_yt_content=obj,
                )
                ptr_entities.append(new_entity)
