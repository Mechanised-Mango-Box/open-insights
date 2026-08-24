from flags import PLATFORM, Platform

if PLATFORM is Platform.WEB:
    import js  # pyrefly: ignore [missing-import]

    from utils import js_fs_import_file, js_fs_import_file_begin
from imgui_bundle import imgui, immapp
from pyodide.ffi import create_proxy

import gui.entity_management
import gui.feature_extraction
import gui.model_analysis


def build_ui():
    # imgui.show_demo_window()
    # imgui.show_metrics_window()
    if imgui.begin_tab_bar("views", imgui.TabBarFlags_.none):
        if imgui.begin_tab_item("Data Management")[0]:
            gui.entity_management.build_page()
            imgui.end_tab_item()

        if imgui.begin_tab_item("Analysis")[0]:
            gui.model_analysis.build_page()
            imgui.end_tab_item()
        imgui.end_tab_bar()


def main():
    if PLATFORM is Platform.WEB:
        js.window.js_fs_import_file_begin = create_proxy(js_fs_import_file_begin)
        js.window.js_fs_import_file = create_proxy(js_fs_import_file)
    immapp.run(
        lambda: build_ui(),
        window_title="Open Insights",
        window_size=(1920, 1080),
        with_implot=True,
        with_markdown=True,
    )


if __name__ == "__main__":
    main()
