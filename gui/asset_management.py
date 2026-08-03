from gui.tables import dataset_table
from imgui_bundle import imgui_md
from gui.tables import register_files
from asset_manager.yt import yt_content_upsert_file
from imgui_bundle import portable_file_dialogs as pfd
from imgui_bundle import imgui
from universe import Universe

def build_page(u:Universe):
    if imgui.begin_tab_item("Import")[0]:
        imgui.text("Add a file or directory:")
        if imgui.button("Add entities (PLACEHOLDER)"):
            selection = pfd.open_file("Select a csv", ".", ["Dataset Files", "*.csv"]).result()
            if len(selection) == 1:
                yt_content_upsert_file(u.db, selection[0])

                u.reload_entity_snapshots()
            else:
                print(f"[ ERR ] Unexpected number of files ({len(selection)})")

        if imgui.button("Add dataset(s)"):
            selection = pfd.open_file("Select a dataset...", ".", ["Dataset Files", "*.csv *.json"], options=pfd.opt.multiselect).result()
            print(selection)
            register_files(u.db, selection)
            u.reload_dataset_snapshots()
        imgui.end_tab_item()

    if imgui.begin_tab_item("Export")[0]:
        imgui.text("Under construction...")
        imgui.end_tab_item()

    if imgui.begin_tab_item("Datasets")[0]:
        imgui_md.render(
            """
## Datasets
This is a list of all datasets.
        """
        )
        dataset_table(u, "dataset_table")
        imgui.end_tab_item()
    if imgui.begin_tab_item("Videos")[0]:
        imgui.text("Under construction...")
        imgui.end_tab_item()
