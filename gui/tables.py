from universe import Universe
from imgui_bundle import imgui
import mimetypes


def dataset_table(u: Universe, element_id: str):
    table_flags = (
        imgui.TableFlags_.borders
        | imgui.TableFlags_.row_bg
        | imgui.TableFlags_.resizable
    )

    if imgui.begin_table(element_id, 3, table_flags):
        # > Generate Headers
        imgui.table_setup_column(
            "ID",
            imgui.TableColumnFlags_.no_resize | imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column(
            "Type",
            imgui.TableColumnFlags_.no_resize | imgui.TableColumnFlags_.width_fixed,
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
            imgui.text(str(snap.path))

        imgui.end_table()


def video_table(u: Universe, element_id: str):
    table_flags = (
        imgui.TableFlags_.borders
        | imgui.TableFlags_.row_bg
        | imgui.TableFlags_.resizable
    )

    if imgui.begin_table(element_id, 3, table_flags):
        # > Generate Headers
        imgui.table_setup_column(
            "ID",
            imgui.TableColumnFlags_.no_resize | imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column(
            "Type",
            imgui.TableColumnFlags_.no_resize | imgui.TableColumnFlags_.width_fixed,
        )
        imgui.table_setup_column("Path")

        imgui.table_headers_row()

        # > Populate
        for snap in u.video_snapshots:
            imgui.table_next_row()

            imgui.table_set_column_index(0)
            imgui.text(str(snap._id))
            imgui.table_set_column_index(1)
            mime, _ = mimetypes.guess_type(snap.path)
            imgui.text(str(mime))
            imgui.table_set_column_index(2)
            imgui.text(str(snap.path))

        imgui.end_table()
