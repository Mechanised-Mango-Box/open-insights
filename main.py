from utils import Success
from utils import Failure
from asset_manager.db import find_entities
from gui.entity_table import register_files
from universe import Universe
from asset_manager.yt import yt_content_upsert_file
from typing import List
from gui.entity_table import entity_table
from asset_manager.db import setup_schema, connect_db
from sqlite3 import Connection
import numpy as np
from imgui_bundle import immapp, implot, imgui_md, imgui
from imgui_bundle import portable_file_dialogs as pfd



def build_ui(u: Universe):
    imgui_md.render(
        """
# Entity

## File Management
Add a file or directory:
    """
    )
    if imgui.button("Add entities (PLACEHOLDER)"):  
        selection = pfd.open_file("Select a csv", ".", ["Dataset Files", "*.csv"]).result()
        print(selection)
        yt_content_upsert_file(u.db,selection[0])

        match find_entities(u.db):
            case Failure(err):
                print(err)
            case Success(snaps):
                u.entity_snapshots.clear()
                u.entity_snapshots.extend(snaps)

    if imgui.button("Add dataset(s)"):  
        selection = pfd.open_file("Select a dataset...", ".", ["Dataset Files", "*.csv *.json"], options=pfd.opt.multiselect).result()
        print(selection)
        register_files(u.db, selection)

    imgui_md.render(
        """
## Entity List
This is a list of all entities.
    """
    )
    entity_table(u, "entity_table")





    imgui_md.render("# **UNDER CONSTRUCTION**")
    # ---- ImPlot example ----
    if implot.begin_plot("My Plot"):
        implot.plot_line("data", np.array([1, 2, 3, 4]), np.array([1, 4, 2, 3]))
        implot.end_plot()


if __name__ == "__main__":
    u: Universe = Universe()
    u.db = connect_db("./index.sqlite")
    setup_schema(u.db)

    immapp.run(lambda: build_ui(u), window_title="My App", window_size=(800, 600), with_implot=True, with_markdown=True)
