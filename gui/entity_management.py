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
"""
    )
    entity_table(u, "entity_table")


def entity_table(u: Universe, element_id: str):
    table_flags = imgui.TableFlags_.borders | imgui.TableFlags_.row_bg | imgui.TableFlags_.resizable

    if imgui.begin_table(element_id, 12, table_flags):
        # > Generate Headers
        imgui.table_setup_column("Display Name")
        imgui.table_setup_column("Video File")

        imgui.table_setup_column("YouTube Hash")
        imgui.table_setup_column("YouTube Title")

        imgui.table_setup_column("Pub Time")
        imgui.table_setup_column("Duration (s)")
        imgui.table_setup_column("Views")

        imgui.table_setup_column("Watch Time (mins)")
        imgui.table_setup_column("Subscribers")
        imgui.table_setup_column("Avg View Duration (s)")

        imgui.table_setup_column("Impressions")
        imgui.table_setup_column("CTR %")
        imgui.table_headers_row()

        # > Populate
        for snap in u.entity_snapshots:
            sub_element_id: str = str(snap._id)
            imgui.table_next_row()

            imgui.table_set_column_index(0)
            clicked, _ = imgui.selectable(f"{snap.display_name}##{sub_element_id}", False, imgui.SelectableFlags_.span_all_columns | imgui.SelectableFlags_.allow_overlap)

            entity_edit_menu(u, sub_element_id, snap, clicked)

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
            imgui.text(str(snap.yt_watch_time * 60))
            imgui.table_set_column_index(8)
            imgui.text(str(snap.yt_subscribers))
            imgui.table_set_column_index(9)
            imgui.text(str(snap.yt_average_view_duration))

            imgui.table_set_column_index(10)
            imgui.text(str(snap.yt_impressions))
            imgui.table_set_column_index(11)
            imgui.text(str(snap.yt_impressions_click_through_rate))

        imgui.end_table()


def entity_edit_menu(u: Universe, popup_id: str, entity_snapshot: EntitySnapshot, just_activated: bool):
    element_id: str = f"Stacked##{popup_id}"

    if just_activated:
        imgui.open_popup(element_id)
        u.editing_entity_snapshot = deepcopy(entity_snapshot)
        u._editing_entity_snapshot_original = deepcopy(entity_snapshot)

    if imgui.begin_popup_modal(element_id, None, imgui.WindowFlags_.menu_bar)[0]:
        assert u.editing_entity_snapshot
        assert u._editing_entity_snapshot_original

        u.editing_entity_snapshot.display_name = draw_labeled_text_field(
            "Display Name", "field_display_name", "Enter text here...", u.editing_entity_snapshot.display_name, u._editing_entity_snapshot_original.display_name
        )
        u.editing_entity_snapshot.video_id = draw_labeled_int_field("Video ID", "field_video_id", u.editing_entity_snapshot.video_id, u._editing_entity_snapshot_original.video_id)
        # TODO make it a query popup
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


def draw_labeled_text_field(label: str, field_id: str, hint: str, current_value: str, original_value: str, flags: int = STD_TEXT_FLAGS) -> str:
    imgui.text(f"{label}: ")
    imgui.same_line()
    just_changed, new_value = imgui.input_text_with_hint(f"##{field_id}", hint, current_value, flags)
    if new_value != original_value:
        imgui.same_line()
        imgui.text("*")
    return new_value if just_changed else current_value


def draw_labeled_int_field(label: str, field_id: str, current_value: Optional[int], original_value: Optional[int]) -> Optional[int]:
    imgui.text(f"{label}: ")
    imgui.same_line()
    just_changed, new_value = imgui.input_int(f"##{field_id}", 0 if current_value is None else current_value, flags=(1 << 13 | 1 << 14))  # display_empty_ref_val | parse_empty_ref_val
    new_value = max(0, new_value)
    if new_value != original_value and current_value is not None:
        imgui.same_line()
        imgui.text("*")

    if new_value is 0:
        new_value = None
    return new_value if just_changed else current_value
