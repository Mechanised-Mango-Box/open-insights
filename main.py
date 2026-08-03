from asset_manager.db import find_datasets
from gui.entity_table import dataset_table
from utils import Success
from utils import Failure
from asset_manager.db import find_entities
from gui.entity_table import register_files
from universe import Universe
from asset_manager.yt import yt_content_upsert_file
from gui.entity_table import entity_table
from asset_manager.db import setup_schema, connect_db
import numpy as np
from imgui_bundle import immapp, implot, imgui_md, imgui
from imgui_bundle import portable_file_dialogs as pfd


def build_ui(u: Universe):
    imgui_md.render(
        """
# Resource Management
## Import
Add a file or directory:
    """
    )
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

    imgui_md.render(
        """
## Entities
This is a list of all entities.
    """
    )
    entity_table(u, "entity_table")

    imgui_md.render(
        """
## Datasets
This is a list of all datasets.
    """
    )
    dataset_table(u, "dataset_table")

    imgui_md.render("# **UNDER CONSTRUCTION**")
    # ImPlot example
    if implot.begin_plot("My Plot"):
        implot.plot_line("data", np.array([1, 2, 3, 4]), np.array([1, 4, 2, 3]))
        implot.end_plot()


if __name__ == "__main__":
    u: Universe = Universe()
    u.db = connect_db("./index.sqlite")
    setup_schema(u.db)

    #> Load the entities once at start of application
    u.reload_entity_snapshots()
    u.reload_dataset_snapshots()

    immapp.run(lambda: build_ui(u), window_title="Open Insights", window_size=(1280, 720), with_implot=True, with_markdown=True)
