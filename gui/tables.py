from utils import VideoSnapshot
from typing_extensions import List
from typing_extensions import Optional
from typing_extensions import Set
from universe import Universe
from imgui_bundle import imgui
from utils import ID
import mimetypes


def dataset_table(u: Universe, element_id: str):
    table_flags = (
        imgui.TableFlags_.borders
        | imgui.TableFlags_.row_bg
        | imgui.TableFlags_.resizable
    )

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

def video_table(
    element_id: str, 
    video_snapshots: List[VideoSnapshot], 
    selected_videos: Set[ID],
    multi_select: bool
):
    table_flags = (
        imgui.TableFlags_.borders
        | imgui.TableFlags_.row_bg
        | imgui.TableFlags_.resizable
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

        # > Populate
        for snap in video_snapshots:
            imgui.table_next_row()

            imgui.table_set_column_index(0)
            in_set = snap._id in selected_videos
            clicked_checkbox, _ = imgui.checkbox(
                f"##{element_id}/checkboxes/{snap._id}", in_set
            )

            imgui.table_set_column_index(1)
            selected_row, _ = imgui.selectable(
                f"{snap._id}##{element_id}/rows/{snap._id}",
                in_set,
                imgui.SelectableFlags_.span_all_columns
                | imgui.SelectableFlags_.no_auto_close_popups,
            )
            
            if clicked_checkbox or selected_row:
                if in_set:
                    selected_videos.remove(snap._id)
                else:
                    if not multi_select:
                        # if single select, always clear selection
                        selected_videos.clear()
                    selected_videos.add(snap._id)


            imgui.table_set_column_index(2)
            mime, _ = mimetypes.guess_type(snap.path)
            imgui.text(str(mime))

            imgui.table_set_column_index(3)
            imgui.text(snap.display_name)
            imgui.table_set_column_index(4)
            imgui.text(snap.path)

        imgui.end_table()