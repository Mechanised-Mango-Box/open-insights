import functools
from utils import Success
from utils import Failure
from asset_manager.db import update_entity
from typing_extensions import Optional
from imgui_bundle import imgui_md
from universe import Universe
from copy import deepcopy
from utils import EntitySnapshot
from universe import Universe
from imgui_bundle import imgui


def build_page(u: Universe):
    imgui_md.render(
        """
## Entities
This is a list of all entities.

Double click to edit. Hold shift to multi-select. Multi-sort is enabled.
"""
    )
    entity_table(u, "entity_table")


def entity_table(u: Universe, element_id: str):
    table_flags = (
        imgui.TableFlags_.borders
        | imgui.TableFlags_.row_bg
        | imgui.TableFlags_.resizable
        | imgui.TableFlags_.sort_tristate
        | imgui.TableFlags_.sort_multi
        | imgui.TableFlags_.sortable
    )
    if imgui.begin_table(element_id, 12, table_flags):
        # > Generate Headers
        imgui.table_setup_column("Display Name")
        imgui.table_setup_column("Video File")

        imgui.table_setup_column("YouTube Hash")
        imgui.table_setup_column("YouTube Title")

        imgui.table_setup_column("Pub Time")
        imgui.table_setup_column("Duration (s)")
        imgui.table_setup_column("Views")

        imgui.table_setup_column("Watch Time (hrs)")
        imgui.table_setup_column("Subscribers")
        imgui.table_setup_column("Avg View Duration (s)")

        imgui.table_setup_column("Impressions")
        imgui.table_setup_column("CTR %")
        imgui.table_headers_row()

        specs = imgui.table_get_sort_specs()
        sorted_snaps = list(u.entity_snapshots)
        if specs and specs.specs_dirty == True:
            specs.specs_dirty = False
        if specs and specs.specs_count > 0:
            # map column index -> value accessor
            def value_for_col(snap, col):
                if col == 0:  return snap.display_name
                if col == 1:  return snap.video_id
                if col == 2:  return snap.yt_hash
                if col == 3:  return snap.yt_title
                if col == 4:  return snap.yt_pub_time
                if col == 5:  return snap.yt_duration
                if col == 6:  return snap.yt_views
                if col == 7:  return snap.yt_watch_time
                if col == 8:  return snap.yt_subscribers
                if col == 9:  return snap.yt_average_view_duration
                if col == 10: return snap.yt_impressions
                if col == 11: return snap.yt_impressions_click_through_rate
                return None

            def col_direction(colspec):
                # direction is binding-dependent; common are:
                # Asc/Desc enums or ints. We'll handle both patterns.
                d = colspec.sort_direction
                # ImGui commonly uses 0=none/asc? but bindings differ.
                # Easiest: treat “descending” as the one that equals imgui.SortDirection_.descending (if present).
                try:
                    return 'desc' if d == imgui.SortDirection.descending else 'asc'
                except Exception:
                    # fallback: if it's an int where desc is 1
                    return 'desc' if d else 'asc'

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
                        return 1 if dir_ == 'asc' else -1
                    if vb is None:
                        return -1 if dir_ == 'asc' else 1

                    if va == vb:
                        continue

                    if va < vb:
                        return -1 if dir_ == 'asc' else 1
                    else:
                        return 1 if dir_ == 'asc' else -1

                return 0

            sorted_snaps.sort(key=functools.cmp_to_key(cmp))
        # > Populate
        for snap in sorted_snaps:
            sub_element_id: str = str(snap._id)
            imgui.table_next_row()

            imgui.table_set_column_index(0)
            _, _ = imgui.selectable(
                f"{snap.display_name}##{sub_element_id}",
                False,
                imgui.SelectableFlags_.span_all_columns
                | imgui.SelectableFlags_.allow_overlap,
            )
            entity_edit_menu(
                u,
                sub_element_id,
                snap,
                imgui.is_item_hovered() and imgui.is_mouse_double_clicked(0),
            )

            imgui.table_set_column_index(1)
            imgui.text(str(snap.video_id))

            imgui.table_set_column_index(2)
            imgui.text(str(snap.yt_hash))
            imgui.table_set_column_index(3)
            imgui.text(str(snap.yt_title))

            imgui.table_set_column_index(4)
            imgui.text(str(snap.yt_pub_time))
            imgui.table_set_column_index(5)
            imgui.text(str(snap.yt_duration))
            imgui.table_set_column_index(6)
            imgui.text(str(snap.yt_views))

            imgui.table_set_column_index(7)
            imgui.text(str(snap.yt_watch_time))
            imgui.table_set_column_index(8)
            imgui.text(str(snap.yt_subscribers))
            imgui.table_set_column_index(9)
            imgui.text(str(snap.yt_average_view_duration))

            imgui.table_set_column_index(10)
            imgui.text(str(snap.yt_impressions))
            imgui.table_set_column_index(11)
            imgui.text(str(snap.yt_impressions_click_through_rate))

        imgui.end_table()


def entity_edit_menu(
    u: Universe, popup_id: str, entity_snapshot: EntitySnapshot, just_activated: bool
):
    element_id: str = f"Stacked##{popup_id}"

    if just_activated:
        imgui.open_popup(element_id)
        u.editing_entity_snapshot = deepcopy(entity_snapshot)
        u._editing_entity_snapshot_original = deepcopy(entity_snapshot)

    if imgui.begin_popup_modal(element_id, None, imgui.WindowFlags_.menu_bar)[0]:
        assert u.editing_entity_snapshot
        assert u._editing_entity_snapshot_original

        u.editing_entity_snapshot.display_name = draw_labeled_text_field(
            "Display Name",
            "field_display_name",
            "Enter text here...",
            u.editing_entity_snapshot.display_name,
            u._editing_entity_snapshot_original.display_name,
        )
        u.editing_entity_snapshot.video_id = draw_labeled_int_field(
            "Video ID",
            "field_video_id",
            u.editing_entity_snapshot.video_id,
            u._editing_entity_snapshot_original.video_id,
        )
        if imgui.button("Cancel"):
            imgui.close_current_popup()
            u.editing_entity_snapshot = None
            u._editing_entity_snapshot_original = None

        imgui.same_line()
        if imgui.button("Save"):
            imgui.close_current_popup()
            print(u.editing_entity_snapshot)
            match update_entity(u.db, u.editing_entity_snapshot):
                case Failure(err):
                    print(err)
                case Success():
                    u.reload_entity_snapshots()
            u.editing_entity_snapshot = None
            u._editing_entity_snapshot_original = None
        imgui.end_popup()


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
