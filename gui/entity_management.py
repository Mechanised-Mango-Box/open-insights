from enum import Enum, auto
from uuid import UUID

from imgui_bundle import imgui

from gui.edit_menu_all import edit_menu_all
from gui.tab_import_export import tab_import_export
from gui.tab_scenes_stats import tab_scenes_stats
from gui.tab_transcript import tab_transcript
from typedef.dataset import (
    ALL_DATASETS,
)
from universe import Universe
from utils import *


class TableSelectMode(Enum):
    NONE = auto()
    SINGLE = auto()
    MULTIPLE = auto()


__selected_ids: set[UUID] = set()


def build_page(u: Universe):
    global __selected_ids

    # > MARK: SECTION: Entity Actions
    if imgui.begin_tab_bar("Entity Actions", imgui.TabBarFlags_.none):
        if imgui.begin_tab_item("Import / Export")[0]:
            tab_import_export(u)
            imgui.end_tab_item()

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
            u.entities = list(filter(lambda ent: ent._id not in __selected_ids, u.entities))
            __selected_ids.clear()
            imgui.close_current_popup()
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
