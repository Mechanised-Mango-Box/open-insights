from universe import Universe
import gui.asset_management
import gui.entity_management
import gui.feature_extraction
import gui.model_analysis
from asset_manager.db import setup_schema, connect_db
from imgui_bundle import immapp, implot, imgui_md, imgui


def build_ui(u: Universe):
    if imgui.begin_tab_bar("views", imgui.TabBarFlags_.none):
        if imgui.begin_tab_item("Asset Management")[0]:
            imgui.text("Import and manage local files for analysis.")
            imgui.end_tab_item()
            if imgui.begin_tab_bar("asset_management_page", imgui.TabBarFlags_.none):
                gui.asset_management.build_page(u)
                imgui.end_tab_bar()

        if imgui.begin_tab_item("Entity List")[0]:
            gui.entity_management.build_page(u)
            imgui.end_tab_item()

        if imgui.begin_tab_item("Feature Extraction")[0]:
            gui.feature_extraction.build_page(u)
            imgui.end_tab_item()

        if imgui.begin_tab_item("Analysis")[0]:
            gui.model_analysis.build_page(u)
            imgui.end_tab_item()
        imgui.end_tab_bar()

if __name__ == "__main__":
    u: Universe = Universe()
    u.db = connect_db("./index.sqlite")
    setup_schema(u.db)

    # > Load the entities once at start of application
    u.reload_entity_snapshots()
    u.reload_dataset_snapshots()

    immapp.run(lambda: build_ui(u), window_title="Open Insights", window_size=(1280, 720), with_implot=True, with_markdown=True)
