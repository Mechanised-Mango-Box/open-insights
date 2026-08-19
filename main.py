# pyrefly: ignore [missing-import]
import whisper
from imgui_bundle import imgui, immapp

import gui.entity_management
import gui.feature_extraction
import gui.model_analysis
from universe import Universe

__temp_selected_id = set()


def build_ui(u: Universe):
    # imgui.show_demo_window()
    # imgui.show_metrics_window()
    if imgui.begin_tab_bar("views", imgui.TabBarFlags_.none):
        if imgui.begin_tab_item("Data Management")[0]:
            gui.entity_management.build_page(u)
            imgui.end_tab_item()

        if imgui.begin_tab_item("Analysis")[0]:
            gui.model_analysis.build_page(u)
            imgui.end_tab_item()
        imgui.end_tab_bar()


def main():
    u: Universe = Universe()
    print("[ Startup ] Loading whisper model...")
    u.whisper_model = whisper.load_model(
        "tiny.en"
    )  # 30min video ~2 mins on gaming rig - cpu only

    immapp.run(
        lambda: build_ui(u),
        window_title="Open Insights",
        window_size=(1920, 1080),
        with_implot=True,
        with_markdown=True,
    )


if __name__ == "__main__":
    main()
