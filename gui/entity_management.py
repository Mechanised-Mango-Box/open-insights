from gui.tables import entity_table
from imgui_bundle import imgui_md
from universe import Universe


def build_page(u: Universe):
    imgui_md.render(
        """
## Entities
This is a list of all entities.
"""
    )
    entity_table(u, "entity_table")
