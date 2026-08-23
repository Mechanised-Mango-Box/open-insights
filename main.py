import js  # pyrefly: ignore [missing-import]
from imgui_bundle import imgui, immapp
from pyodide.ffi import create_proxy

import gui.entity_management
import gui.feature_extraction
import gui.model_analysis
from universe import Universe


def process_file_from_js(uint8_array):
    try:
        # CORRECT WAY: Convert the JS Proxy/Uint8Array to Python bytes
        file_bytes = bytes(uint8_array)
        
        print(f"Successfully received file! Size: {len(file_bytes)} bytes")
        
        # Save it to the virtual filesystem so ImGui/Python can read it
        with open("/tmp/user_file.dat", "wb") as f:
            f.write(file_bytes)
            
        print("File saved to /tmp/user_file.dat")

        with open("/tmp/user_file.dat", "r") as f:
            print(f.readlines())
        
    except Exception as e:
        print(f"Error processing file in Python: {e}")



def trigger_web_file_picker():
    js.document.getElementById("file-picker").click()


# Example: Triggering it via an ImGui button click (simplified)
# trigger_web_file_picker()


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
    # IMPORTANT: You must expose this function to the global 'window' object
    # so JavaScript can see it.
    js.window.process_file_from_js = create_proxy(process_file_from_js)

    u: Universe = Universe()

    immapp.run(
        lambda: build_ui(u),
        window_title="Open Insights",
        window_size=(1920, 1080),
        with_implot=True,
        with_markdown=True,
    )


if __name__ == "__main__":
    main()
