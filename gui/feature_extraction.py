from imgui_bundle import imgui
from universe import Universe


def build_page(u: Universe):
    if imgui.begin_tab_bar("views", imgui.TabBarFlags_.none):
        if imgui.begin_tab_item("Transcript (Whisper)")[0]:
            if imgui.button("PLACEHOLDER - APPLY TO ALL, OVERWRITE MODE"):
                # load model
                for ent in u.entities:
                    #> Update
                    path = ent.file_path
                    if path is None:
                        continue
                    with path.open(mode="r") as media_handle:
                        pass
            imgui.end_tab_item()

        if imgui.begin_tab_item("Scene Stats (OpenCV)")[0]:
            imgui.end_tab_item()

        imgui.end_tab_bar()

    imgui.text("WIP - TABLE HERE")
