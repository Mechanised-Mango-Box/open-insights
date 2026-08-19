import csv
from datetime import datetime, timezone
from enum import Enum, auto
from pathlib import Path
from uuid import UUID, uuid4

from imgui_bundle import imgui
from imgui_bundle import portable_file_dialogs as pfd

from typedef.dataset_variants import (
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


def build_page(u: Universe):
    global __selected_ids
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
                        lambda entity: is_same_hash(entity, selected_hash), u.entities
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
        print(u.entities)
    # > MARK: Selection Actions
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
        _ = export_all(Path(out_dir), u.entities)
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


def export_all(target_dir: Path, entities: list[Video]) -> Result[None, str]:
    ts_start = datetime.now(timezone.utc)
    ts_start_iso = ts_start.isoformat()
    print(
        f"""[ Export] Starting export at {ts_start_iso}.
    \t> Target: {target_dir}
    \t> Count: {len(entities)}"""
    )

    # > MARK: 1. Validation
    if len(entities) <= 0:
        return Failure("No entities selected.")
    if not (target_dir.exists(), target_dir.is_dir()):
        return Failure(f"Path provided is invalid: {target_dir}")

    # > MARK: 2. Make export folder
    print("[ Export ] Generating output folder...")
    out_dir = target_dir / ts_start_iso
    out_dir.mkdir()
    print(f"[ Export ] Output folder: {out_dir}")

    # > MARK: 3. Generate manifest
    print("[ Export ] Generating manifest...")
    manifest_path = out_dir / "manifest.csv"
    with manifest_path.open("w") as f:
        f.writelines("id,file_hash,display_name\n")
        manifest_text = (
            f"{ent._id},{ent.file_hash},{ent.display_name}\n" for ent in entities
        )
        f.writelines(manifest_text)
    print(f"[ Export ] Manifest complete at {manifest_path}")

    # > MARK: 4. Datasets
    print("[ Export ] Generating dataset folder...")
    data_dir = out_dir / "data"
    data_dir.mkdir()
    print(f"[ Export ] Dataset folder: {data_dir}")
    for DS in ALL_DATASETS:
        DS.export(data_dir, entities)
    print("[ Export ] Complete.")

    print("[ Export ] Export process complete.")
    return Success(None)


ptr_edit_menu_all_edit_youtube_content: Ref[DatasetYoutubeContent | None] = Ref(None)
ptr_edit_menu_all_edit_youtube_audience_retention: Ref[
    DatasetYoutubeAudienceRetention | None
] = Ref(None)
ptr_edit_menu_all_edit_whisper_transcript: Ref[DatasetWhisperTranscript | None] = Ref(
    None
)
ptr_edit_menu_all_edit_transcript_stats: Ref[DatasetTranscriptStats | None] = Ref(None)
ptr_edit_menu_all_edit_scene_stats: Ref[DatasetOpenCVSceneStats | None] = Ref(None)


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
            ptr_edit_menu_all_edit_youtube_content,
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
                ptr_edit_menu_all_edit_youtube_audience_retention,
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
            ptr_edit_menu_all_edit_whisper_transcript,
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
            ptr_edit_menu_all_edit_transcript_stats,
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
            ptr_edit_menu_all_edit_scene_stats,
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
