from pathlib import Path
from uuid import uuid4

from imgui_bundle import imgui
from imgui_bundle import portable_file_dialogs as pfd

from export import export_selection
from typedef.dataset import DatasetYoutubeContent
from typedef.video import Video
from universe import Universe
from utils import *


def upsert_yt_content_csv(path: str, ptr_entities: list[Video]):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)  # columns become dict keys
        for row in reader:
            # > Read as obj
            obj = DatasetYoutubeContent(
                content_id=row["Content"],
                title=row["Video title"],
                pub_time=row["Video publish time"],
                duration=int(row["Duration"]),
                views=int(row["Views"]),
                watch_time=float(row["Watch time (hours)"]),
                subscribers=int(row["Subscribers"]),
                average_view_duration=row["Average view duration"],
                impressions=int(row["Impressions"]),
                impressions_click_through_rate=(
                    float(x)
                    if (x := row["Impressions click-through rate (%)"]) is not None
                    and ""
                    else None
                ),
            )

            # >  Insert into universe
            has_repalced_existing = False
            for entity in ptr_entities:
                # > Same ID -> replace
                if (
                    entity.ds_yt_content
                    and entity.ds_yt_content.content_id == obj.content_id
                ):
                    entity.ds_yt_content = obj
                    has_repalced_existing = True
                    break

            if not has_repalced_existing:
                new_entity = Video(
                    _id=uuid4(),
                    file_hash=None,
                    file_path=None,
                    display_name=e_str(obj.title),
                    ds_yt_content=obj,
                )
                ptr_entities.append(new_entity)

def tab_import_export(u: Universe):
    # > YT Content
    if imgui.button("Import from: Youtube Content"):
        selection = pfd.open_file(
            "Upload Youtube Content Report...",
            ".",
            ["Youtube Content Report (CSV)", "*.csv"],
            options=pfd.opt.none,
        ).result()
        assert len(selection) <= 1

        if len(selection) == 0:
            print("No file selected.")
        else:
            path = selection[0]

            upsert_yt_content_csv(path, u.entities)
            print(u.entities)
    # > Video
    if imgui.button("Import from: Video File"):
        selection = pfd.open_file(
            "Upload Video(s)...",
            ".",
            ["Video(s)", "*.mp4"],
            options=pfd.opt.multiselect,
        ).result()

        if len(selection) == 0:
            print("No file selected.")
        else:
            for str_path in selection:
                path = Path(str_path)
                selected_hash = file_hash(path)

                def is_same_hash(entity: Video, other_hash: str):
                    if not entity.file_hash:
                        return False
                    return entity.file_hash == other_hash

                print(selected_hash)
                matching = list(
                    filter(
                        lambda entity: is_same_hash(entity, selected_hash),
                        u.entities,
                    )
                )
                print(matching)

                if len(matching) <= 0:
                    # * None match, insert new
                    new_entity = Video(
                        _id=uuid4(),
                        file_hash=selected_hash,
                        file_path=path,
                        display_name=path.stem,
                    )  # TODO make file the name not the whole path
                    u.entities.append(new_entity)
                else:
                    # * Update
                    for matching_entity in matching:
                        print("MATCH", matching_entity)

    # > Export
    if imgui.button("Export"):
        out_dir = pfd.select_folder(
            "Select export location...",
            ".",
            options=pfd.opt.none,
        ).result()
        _ = export_selection(Path(out_dir), u.entities)
