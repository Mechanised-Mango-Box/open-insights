from gui import build_ui
from asset_manager.db import setup_schema, connect_db
from sqlite3 import Connection
import dearpygui.dearpygui as dpg

dpg.create_context()
dpg.create_viewport(title="Open Insights", width=1100, height=650)

db_connection: Connection = connect_db("./index.sqlite")
setup_schema(db_connection)
build_ui(db_connection)

dpg.setup_dearpygui()
dpg.show_viewport()
dpg.start_dearpygui()
dpg.destroy_context()
