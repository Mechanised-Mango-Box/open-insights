from typing_extensions import Sequence
from utils import Rowable
from enum import auto
from enum import Enum
import enum
from typing import Any
from typing_extensions import Callable
import functools
from asset_manager.db import update_video
from utils import Success
from utils import Failure
from asset_manager.db import update_dataset
from copy import deepcopy
from utils import Ref
from utils import DatasetSnapshot
from utils import RefNullable
from utils import VideoSnapshot
from typing_extensions import List
from typing_extensions import Optional
from typing_extensions import Set
from universe import Universe
from imgui_bundle import imgui
from utils import ID
import mimetypes


def dataset_table(u: Universe, element_id: str):
    table_flags = imgui.TableFlags_.borders | imgui.TableFlags_.row_bg | imgui.TableFlags_.resizable

    if imgui.begin_table(element_id, 5, table_flags):
        # > Generate Headers
        imgui.table_setup_column(
            "ID",
            imgui.TableColumnFlags_.no_resize | imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column(
            "Type",
            imgui.TableColumnFlags_.no_resize | imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column(
            "Name",
            imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column(
            "Source",
            imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column("Path")
        imgui.table_headers_row()

        # > Populate
        for snap in u.dataset_snapshots:
            imgui.table_next_row()

            imgui.table_set_column_index(0)
            imgui.text(str(snap._id))
            imgui.table_set_column_index(1)
            mime, _ = mimetypes.guess_type(snap.path)
            imgui.text(str(mime))

            imgui.table_set_column_index(2)
            imgui.text(snap.display_name)
            if snap.source:
                imgui.table_set_column_index(3)
                imgui.text(snap.source)
            imgui.table_set_column_index(4)
            imgui.text(snap.path)

        imgui.end_table()


__entity_edit_menu_video_selection: Set[ID] = set()
__editing_video_snapshot: RefNullable[VideoSnapshot] = RefNullable(None)
__editing_video_snapshot_original: RefNullable[VideoSnapshot] = RefNullable(None)
__dirty_video_edit_menu_is_active: Ref[bool] = Ref(False)


def video_table(
    element_id: str,
    u: Universe,
    video_snapshots: List[VideoSnapshot],
    selected_videos: Set[ID],
    multi_select: bool,
    allow_edit_menu: bool,
):
    table_flags = (
        imgui.TableFlags_.borders
        | imgui.TableFlags_.row_bg
        | imgui.TableFlags_.resizable
        | imgui.TableFlags_.sort_tristate
        | imgui.TableFlags_.sort_multi
        | imgui.TableFlags_.sortable
    )

    if imgui.begin_table(element_id, 5, table_flags):
        # > Generate Headers
        imgui.table_setup_column(
            "",
            imgui.TableColumnFlags_.no_sort
            | imgui.TableColumnFlags_.no_resize
            | imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column(
            "ID",
            imgui.TableColumnFlags_.no_resize | imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column(
            "Type",
            imgui.TableColumnFlags_.no_resize | imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column(
            "Name",
            imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column("Path")
        imgui.table_headers_row()

        specs = imgui.table_get_sort_specs()
        sorted_snaps = list(video_snapshots)

        if specs and specs.specs_dirty == True:
            specs.specs_dirty = False
        if specs and specs.specs_count > 0:
            # map column index -> value accessor
            def value_for_col(snap, col):
                if col == 1:
                    return snap._id
                if col == 2:
                    return mimetypes.guess_type(snap.path)[0]
                if col == 3:
                    return snap.display_name
                if col == 4:
                    return snap.path
                return None

            def col_direction(colspec):
                d = colspec.sort_direction
                try:
                    return "desc" if d == imgui.SortDirection.descending else "asc"
                except Exception:
                    # fallback: if it's an int where desc is 1
                    return "desc" if d else "asc"

            def cmp(a, b):
                # multi-sort: iterate each column sort spec in order
                for i in range(specs.specs_count):
                    s = specs.get_specs(i)
                    col = s.column_index
                    dir_ = col_direction(s)

                    va = value_for_col(a, col)
                    vb = value_for_col(b, col)

                    # handle None deterministically
                    if va is None and vb is None:
                        continue
                    if va is None:
                        return 1 if dir_ == "asc" else -1
                    if vb is None:
                        return -1 if dir_ == "asc" else 1

                    if va == vb:
                        continue

                    if va < vb:
                        return -1 if dir_ == "asc" else 1
                    else:
                        return 1 if dir_ == "asc" else -1

                return 0

            sorted_snaps.sort(key=functools.cmp_to_key(cmp))
        # > Populate
        for snap in sorted_snaps:
            imgui.table_next_row()

            imgui.table_set_column_index(0)
            in_set = snap._id in selected_videos
            clicked_checkbox, _ = imgui.checkbox(f"##{element_id}/checkboxes/{snap._id}", in_set)

            imgui.table_set_column_index(1)
            _, _ = imgui.selectable(
                f"{snap._id}##{element_id}/rows/{snap._id}",
                in_set,
                imgui.SelectableFlags_.span_all_columns
                | imgui.SelectableFlags_.no_auto_close_popups,
            )

            if clicked_checkbox:
                if in_set:
                    selected_videos.remove(snap._id)
                else:
                    if not multi_select:
                        # if single select, always clear selection
                        selected_videos.clear()
                    selected_videos.add(snap._id)

            if allow_edit_menu:
                video_edit_menu(
                    f"{element_id}/video_edit_menu/{snap._id}",
                    u,
                    __editing_video_snapshot,
                    __editing_video_snapshot_original,
                    snap,
                    imgui.is_item_hovered() and imgui.is_mouse_double_clicked(0),
                    __dirty_video_edit_menu_is_active,
                )

            imgui.table_set_column_index(2)
            mime, _ = mimetypes.guess_type(snap.path)
            imgui.text(str(mime))

            imgui.table_set_column_index(3)
            imgui.text(snap.display_name)
            imgui.table_set_column_index(4)
            imgui.text(snap.path)

        imgui.end_table()


STD_TEXT_FLAGS = 4224  # auto_select_all (12) | escape_clears_all (7)


def draw_labeled_text_field(
    label: str,
    field_id: str,
    hint: str,
    current_value: str,
    original_value: str,
    flags: int = STD_TEXT_FLAGS,
) -> str:
    imgui.text(f"{label}: ")
    imgui.same_line()
    just_changed, new_value = imgui.input_text_with_hint(
        f"##{field_id}", hint, current_value, flags
    )
    if new_value != original_value:
        imgui.same_line()
        imgui.text("*")
    return new_value if just_changed else current_value


def draw_labeled_int_field(
    label: str,
    field_id: str,
    current_value: Optional[int],
    original_value: Optional[int],
) -> Optional[int]:
    imgui.text(f"{label}: ")
    imgui.same_line()
    just_changed, new_value = imgui.input_int(
        f"##{field_id}",
        0 if current_value is None else current_value,
        flags=(1 << 13 | 1 << 14),
    )  # display_empty_ref_val | parse_empty_ref_val
    new_value = max(0, new_value)
    if new_value != original_value and current_value is not None:
        imgui.same_line()
        imgui.text("*")

    if new_value == 0:
        new_value = None
    return new_value if just_changed else current_value


def video_edit_menu(
    popup_id: str,
    u: Universe,
    REF_editing_video_snapshot: RefNullable[VideoSnapshot],
    REF_editing_video_snapshot_original: RefNullable[VideoSnapshot],
    edit_target_video: VideoSnapshot,
    just_activated: bool,
    REF_is_active: Ref[bool],
):
    element_id: str = f"Edit Video##{popup_id}"

    if just_activated:
        imgui.open_popup(element_id)
        assert edit_target_video
        REF_editing_video_snapshot._ = deepcopy(edit_target_video)
        REF_editing_video_snapshot_original._ = deepcopy(edit_target_video)
        REF_is_active._ = True

    is_active = REF_is_active._
    if imgui.begin_popup_modal(element_id, None, imgui.WindowFlags_.no_saved_settings)[0]:
        assert REF_editing_video_snapshot._
        assert REF_editing_video_snapshot_original._

        # > Display name
        REF_editing_video_snapshot._.display_name = draw_labeled_text_field(
            "Display Name",
            "field_display_name",
            "Enter text here...",
            REF_editing_video_snapshot._.display_name,
            REF_editing_video_snapshot_original._.display_name,
        )

        # > Actions
        if imgui.button("Save"):
            imgui.close_current_popup()
            REF_is_active._ = False
            print(REF_editing_video_snapshot._)
            match update_video(u.db, REF_editing_video_snapshot._):
                case Failure(err):
                    print(err)
                case Success():
                    u.reload_video_snapshots()
            REF_editing_video_snapshot._ = None
            REF_editing_video_snapshot_original._ = None
        imgui.same_line()
        if imgui.button("Cancel"):
            imgui.close_current_popup()
            REF_is_active._ = False
            REF_editing_video_snapshot._ = None
            REF_editing_video_snapshot_original._ = None

        imgui.end_popup()


class TableSelectMode(Enum):
    NONE = auto()
    SINGLE = auto()
    MULTIPLE = auto()


def smart_table(
    element_id: str,
    # * Rows
    rows: Sequence[Rowable],
    headers: Sequence[str],
    # column_flags: List[int],
    # on_update_row: Callable[[None], None],
    # * Selection
    selected_ids: Set[ID],
    table_select_mode: TableSelectMode,
    # * Events
    on_double_click: Optional[Callable[[Rowable, bool], None]],
):
    # > Data Validation & Setup
    if len(rows) <= 0:
        return
    # assert len(rows) == len(column_flags)
    column_count: int = len(headers)
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
    if imgui.begin_table(element_id, column_count + (1 if show_select_box else 0), table_flags):
        # > Generate Headers
        if show_select_box:
            imgui.table_setup_column(
                "",
                imgui.TableColumnFlags_.no_sort
                | imgui.TableColumnFlags_.no_resize
                | imgui.TableColumnFlags_.width_fixed,
            )
        for header in headers:
            imgui.table_setup_column(header)
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
            for j, cell in enumerate(row.as_row()):
                imgui.table_next_column()
                if j == 0:
                    _, _ = imgui.selectable(
                        f"{row._id}##{element_id}/rows/{row._id}",
                        in_selected,
                        imgui.SelectableFlags_.span_all_columns
                        | imgui.SelectableFlags_.no_auto_close_popups,
                    )

                    if on_double_click is not None:
                        on_double_click(row, imgui.is_item_hovered() and imgui.is_mouse_double_clicked(0))
                else:
                    imgui.text(str(cell))

                # video_edit_menu(
                #     f"{element_id}/video_edit_menu/{snap._id}",
                #     u,
                #     __editing_video_snapshot,
                #     __editing_video_snapshot_original,
                #     snap,
                #     imgui.is_item_hovered() and imgui.is_mouse_double_clicked(0),
                #     __dirty_video_edit_menu_is_active,
                # )

    imgui.end_table()
