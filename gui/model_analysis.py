from imgui_bundle import implot
from imgui_bundle import imgui_md
from universe import Universe
import numpy as np

def build_page(u:Universe):
    imgui_md.render("# **UNDER CONSTRUCTION**")
    # ImPlot example
    if implot.begin_plot("My Plot"):
        implot.plot_line("data", np.array([1, 2, 3, 4]), np.array([1, 4, 2, 3]))
        implot.end_plot()
