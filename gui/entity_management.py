import csv
from utils import tuple_to_csv_row
from asset_manager.training_resources import fetch_entity_snapshot
from asset_manager.training_resources import TrainingResourcesManifest
from gui.tables import draw_labeled_text_field
from utils import RefNullable
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

# MARK: Static
#> Export
__export_save_dialog = None
__selecting_entity_id_set: Set[int] = set()
#> Table
__entity_edit_menu_video_selection: Set[ID] = set()

#> Edit Menu
__edit_menu_video_search_filter = imgui.TextFilter()
__editing_entity_snapshot: RefNullable[EntitySnapshot] = RefNullable(None)
__editing_entity_snapshot_original: RefNullable[EntitySnapshot] = RefNullable(None)
__dirty_entity_edit_menu_is_active: Ref[bool] = Ref(False)


def build_page(u: Universe):
    global __export_save_dialog
    global __selecting_entity_id_set

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


    if imgui.button("Select All"):
        if len(__selecting_entity_id_set) == len(u.entity_snapshots):
            __selecting_entity_id_set.clear()
        else:
            __selecting_entity_id_set |= set(map(lambda snap: snap._id, u.entity_snapshots))
        # for snap in u.entity_snapshots:
        #     REF_selected_entity_set.add(snap._id)

    if len(__selecting_entity_id_set) == 0:
        imgui.begin_disabled()
        
    imgui.same_line()

    if imgui.button("Delete"):
        imgui.open_popup("Delete Confirmation")
    if imgui.begin_popup_modal(
        "Delete Confirmation", None, imgui.WindowFlags_.no_resize
    )[0]:
        imgui.text(f"Deleting {len(__selecting_entity_id_set)} items.")
        if imgui.button("Delete"):
            for e_id in __selecting_entity_id_set:
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
        __export_save_dialog = pfd.save_file("Export selected as CSV", "./entities.csv")

    if __export_save_dialog and __export_save_dialog.ready():
        saved_file_path = __export_save_dialog.result()
        if saved_file_path:
            try:
                export_snaps = filter(
                    lambda snap: snap._id in __selecting_entity_id_set, u.entity_snapshots
                )

                export_body = map(lambda snap: snap.to_row(), export_snaps)
                with open(
                    saved_file_path, mode="w", newline="", encoding="utf-8"
                ) as file:
                    writer = csv.writer(file)
                    writer.writerow(EntitySnapshot.csv_header())
                    writer.writerows(export_body)

            except Exception as e:
                print(f"Error creating file: {e}")

    if len(__selecting_entity_id_set) == 0:
        imgui.end_disabled()

    entity_table(u, "entity_table", __selecting_entity_id_set)


def entity_table(u: Universe, element_id: str, REF_selected_entity_set: Set[ID]):
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

        imgui.table_setup_column("Youtube Hash")
        imgui.table_setup_column("Youtube Title")

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
            in_set = snap._id in REF_selected_entity_set
            clicked, _ = imgui.checkbox(f"##{element_id}/{snap._id}", in_set)
            if clicked:
                if in_set:
                    REF_selected_entity_set.remove(snap._id)
                else:
                    REF_selected_entity_set.add(snap._id)

            imgui.table_set_column_index(1)
            _, _ = imgui.selectable(
                f"{snap.display_name}##{snap._id}",
                False,
                imgui.SelectableFlags_.span_all_columns
                | imgui.SelectableFlags_.no_auto_close_popups,
            )

            entity_edit_menu(
                str(snap._id),
                u,
                __editing_entity_snapshot,
                __editing_entity_snapshot_original,
                snap,
                imgui.is_item_hovered() and imgui.is_mouse_double_clicked(0),
                __dirty_entity_edit_menu_is_active,
                __entity_edit_menu_video_selection,
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


def entity_edit_menu(
    popup_id: str,
    u: Universe,
    REF_editing_entity_snapshot: RefNullable[EntitySnapshot],
    REF_editing_entity_snapshot_original: RefNullable[EntitySnapshot],
    edit_target_entity: EntitySnapshot,
    just_activated: bool,
    REF_is_active: Ref[bool],
    video_selection: Set[ID],
):
    element_id: str = f"Edit Entity##{popup_id}"

    if just_activated:
        imgui.open_popup(element_id)
        assert edit_target_entity
        REF_editing_entity_snapshot._ = deepcopy(edit_target_entity)
        REF_editing_entity_snapshot_original._ = deepcopy(edit_target_entity)
        REF_is_active._ = True

    if imgui.begin_popup_modal(element_id, None, imgui.WindowFlags_.no_saved_settings)[
        0
    ]:
        assert REF_editing_entity_snapshot._
        assert REF_editing_entity_snapshot_original._

        # > Display name
        REF_editing_entity_snapshot._.display_name = draw_labeled_text_field(
            "Display Name",
            "field_display_name",
            "Enter text here...",
            REF_editing_entity_snapshot._.display_name,
            REF_editing_entity_snapshot_original._.display_name,
        )
        # > Video file
        imgui.text(f"Video ID: {REF_editing_entity_snapshot._.video_id}")
        imgui.same_line()
        if imgui.tree_node(f"(expand to edit)##{element_id}/search_video_id"):
            if imgui.button("Use Selected Video"):
                assert len(video_selection) <= 1
                if len(video_selection) > 0:
                    REF_editing_entity_snapshot._.video_id = next(iter(video_selection))
                else:
                    REF_editing_entity_snapshot._.video_id = None

            imgui.text("Search video name: ")
            imgui.same_line()
            __edit_menu_video_search_filter.draw()
            lines = list(
                filter(
                    lambda snapshot: __edit_menu_video_search_filter.pass_filter(
                        snapshot.display_name + snapshot.path
                    ),
                    u.video_snapshots,
                )
            )

            video_table(
                f"{element_id}/video_query_res", u, lines, video_selection, False, False
            )
            imgui.tree_pop()

        # > Actions
        if imgui.button("Save"):
            imgui.close_current_popup()
            REF_is_active._ = False
            print(REF_editing_entity_snapshot._)
            match update_entity(u.db, REF_editing_entity_snapshot._):
                case Failure(err):
                    print(err)
                case Success():
                    u.reload_entity_snapshots()
            REF_editing_entity_snapshot._ = None
            REF_editing_entity_snapshot_original._ = None
            video_selection.clear()
        imgui.same_line()
        if imgui.button("Cancel"):
            imgui.close_current_popup()
            REF_is_active._ = False
            REF_editing_entity_snapshot._ = None
            REF_editing_entity_snapshot_original._ = None
            video_selection.clear()

        imgui.end_popup()
