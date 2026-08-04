from imgui_bundle.imgui import same_line
from utils import Ref
from gui.tables import video_table
from utils import ID
from typing_extensions import Set
import imgui_bundle.portable_file_dialogs as pfd
from asset_manager.yt import yt_content_upsert_file
from asset_manager.db import delete_entity
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

entity_edit_menu_video_selection: Set[ID] = set()


def build_page(u: Universe):
    if imgui.button("Add entities (PLACEHOLDER)"):
        selection = pfd.open_file(
            "Select a csv", ".", ["Dataset Files", "*.csv"]
        ).result()
        if len(selection) == 1:
            yt_content_upsert_file(u.db, selection[0])

            u.reload_entity_snapshots()
        else:
            print(f"[ ERR ] Unexpected number of files ({len(selection)})")

    imgui_md.render(
        """
# Entities
This is a list of all entities.

Double click to edit. Multi-sort is enabled.
"""
    )
    imgui.new_line()
    entity_table(u, "entity_table", u.selecting_entity_id_set)


def entity_table(u: Universe, element_id: str, OUT_selected_entity_set: Set[ID]):
    global entity_edit_menu_video_selection
    if len(OUT_selected_entity_set) == 0:
        imgui.begin_disabled()
    imgui_md.render("**Selection Actions**")

    if imgui.button("Delete"):
        imgui.open_popup("Delete Confirmation")
    if imgui.begin_popup_modal(
        "Delete Confirmation", None, imgui.WindowFlags_.no_resize
    )[0]:
        imgui.text(f"Deleting {len(OUT_selected_entity_set)} items.")
        if imgui.button("Delete"):
            for e_id in OUT_selected_entity_set:
                match delete_entity(u.db, e_id):
                    case Failure(err):
                        print(err)
                        break
            u.reload_entity_snapshots()
            imgui.close_current_popup()
        imgui.same_line()
        if imgui.button("Cancel"):
            imgui.close_current_popup()
        imgui.end_popup()

    imgui.same_line()
    if imgui.button("Export"):
        imgui.open_popup("Export Configuration")
    if imgui.begin_popup_modal("Export Configuration", None)[0]:
        imgui.text(f"Under construction")
        if imgui.button("Cancel"):
            imgui.close_current_popup()
        imgui.end_popup()

    if len(OUT_selected_entity_set) == 0:
        imgui.end_disabled()

    table_flags = (
        imgui.TableFlags_.borders
        | imgui.TableFlags_.row_bg
        | imgui.TableFlags_.resizable
        | imgui.TableFlags_.sort_tristate
        | imgui.TableFlags_.sort_multi
        | imgui.TableFlags_.sortable
    )
    if imgui.begin_table(element_id, 13, table_flags):
        # > Generate Headers
        imgui.table_setup_column(
            "",
            imgui.TableColumnFlags_.no_sort
            | imgui.TableColumnFlags_.no_resize
            | imgui.TableColumnFlags_.width_fixed,
        )

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
                if col == 1:
                    return snap.display_name
                if col == 2:
                    return snap.video_id
                if col == 3:
                    return snap.yt_hash
                if col == 4:
                    return snap.yt_title
                if col == 5:
                    return snap.yt_pub_time
                if col == 6:
                    return snap.yt_duration
                if col == 7:
                    return snap.yt_views
                if col == 8:
                    return snap.yt_watch_time
                if col == 9:
                    return snap.yt_subscribers
                if col == 10:
                    return snap.yt_average_view_duration
                if col == 11:
                    return snap.yt_impressions
                if col == 12:
                    return snap.yt_impressions_click_through_rate
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
            in_set = snap._id in OUT_selected_entity_set
            clicked, _ = imgui.checkbox(f"##{element_id}/{snap._id}", in_set)
            if clicked:
                if in_set:
                    OUT_selected_entity_set.remove(snap._id)
                else:
                    OUT_selected_entity_set.add(snap._id)

            imgui.table_set_column_index(1)
            _, _ = imgui.selectable(
                f"{snap.display_name}##{snap._id}",
                False,
                imgui.SelectableFlags_.span_all_columns
                | imgui.SelectableFlags_.no_auto_close_popups,
            )

            entity_edit_menu(
                u,
                str(snap._id),
                snap,
                imgui.is_item_hovered() and imgui.is_mouse_double_clicked(0),
                dirty_entity_edit_menu_is_active,
                entity_edit_menu_video_selection,
            )

            imgui.table_set_column_index(2)
            imgui.text(str(snap.video_id))

            imgui.table_set_column_index(3)
            imgui.text(str(snap.yt_hash))
            imgui.table_set_column_index(4)
            imgui.text(str(snap.yt_title))

            imgui.table_set_column_index(5)
            imgui.text(str(snap.yt_pub_time))
            imgui.table_set_column_index(6)
            imgui.text(str(snap.yt_duration))
            imgui.table_set_column_index(7)
            imgui.text(str(snap.yt_views))

            imgui.table_set_column_index(8)
            imgui.text(str(snap.yt_watch_time))
            imgui.table_set_column_index(9)
            imgui.text(str(snap.yt_subscribers))
            imgui.table_set_column_index(10)
            imgui.text(str(snap.yt_average_view_duration))

            imgui.table_set_column_index(11)
            imgui.text(str(snap.yt_impressions))
            imgui.table_set_column_index(12)
            imgui.text(str(snap.yt_impressions_click_through_rate))

        imgui.end_table()


dirty_entity_edit_menu_is_active: Ref[bool] = Ref(False)
text_filter = imgui.TextFilter()


def entity_edit_menu(
    u: Universe,
    popup_id: str,
    entity_snapshot: EntitySnapshot,
    just_activated: bool,
    OUT_is_active: Ref[bool],
    video_selection: Set[ID],
):
    element_id: str = f"Edit Entity##{popup_id}"

    if just_activated:
        imgui.open_popup(element_id)
        u.editing_entity_snapshot = deepcopy(entity_snapshot)
        u._editing_entity_snapshot_original = deepcopy(entity_snapshot)
        OUT_is_active.value = True

    foo = OUT_is_active.value
    if imgui.begin_popup_modal(element_id, foo, imgui.WindowFlags_.menu_bar)[0]:
        assert u.editing_entity_snapshot
        assert u._editing_entity_snapshot_original

        # > Display name
        u.editing_entity_snapshot.display_name = draw_labeled_text_field(
            "Display Name",
            "field_display_name",
            "Enter text here...",
            u.editing_entity_snapshot.display_name,
            u._editing_entity_snapshot_original.display_name,
        )
        # > Video file
        imgui.text(f"Video ID: {u.editing_entity_snapshot.video_id}") 
        imgui.same_line()
        if imgui.tree_node(
            f"(expand to edit)##{element_id}/search_video_id"
        ):
            if imgui.button("Use Selected Video"):
                assert len(video_selection) <= 1
                if len(video_selection) > 0:
                    u.editing_entity_snapshot.video_id = next(iter(video_selection))
                else:
                    u.editing_entity_snapshot.video_id = None

            imgui.text("Search video name: ")
            imgui.same_line()
            text_filter.draw()
            lines = list(
                filter(
                    lambda snapshot: text_filter.pass_filter(snapshot.display_name),
                    u.video_snapshots,
                )
            )

            video_table(f"{element_id}/video_query_res", lines, video_selection, False)
            imgui.tree_pop()

        # > Actions
        if imgui.button("Save"):
            imgui.close_current_popup()
            OUT_is_active.value = False
            print(u.editing_entity_snapshot)
            match update_entity(u.db, u.editing_entity_snapshot):
                case Failure(err):
                    print(err)
                case Success():
                    u.reload_entity_snapshots()
            u.editing_entity_snapshot = None
            u._editing_entity_snapshot_original = None
        imgui.same_line()
        if imgui.button("Cancel"):
            imgui.close_current_popup()
            OUT_is_active.value = False
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
