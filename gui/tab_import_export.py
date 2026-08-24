import csv
from pathlib import Path
from uuid import uuid4

from imgui_bundle import imgui
from imgui_bundle import portable_file_dialogs as pfd

from export import export_selection
from flags import PLATFORM, Platform
from typedef.dataset import DatasetYoutubeContent, Video
from universe import Universe
from utils import e_str, file_hash, file_select_native, file_select_web


def safe_cast(val: str | None, to_type: type, default=None):
    """Safely casts a string value to a type. Returns default if casting fails."""
    if val is None or val.strip() == "":
        return default
    try:
        return to_type(val)
    except (ValueError, TypeError):
        return default


def upsert_yt_content_csv(path: Path, ptr_entities: list[Video]):
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            obj = DatasetYoutubeContent(
                content_id=row.get("Content"),
                title=row.get("Video title"),
                pub_time=row.get("Video publish time"),
                duration=safe_cast(row.get("Duration"), int, 0),
                views=safe_cast(row.get("Views"), int, 0),
                watch_time=safe_cast(row.get("Watch time (hours)"), float, 0.0),
                subscribers=safe_cast(row.get("Subscribers"), int, 0),
                average_view_duration=row.get("Average view duration"),
                impressions=safe_cast(row.get("Impressions"), int, 0),
                impressions_click_through_rate=safe_cast(
                    row.get("Impressions click-through rate (%)"), float, None
                ),
            )

            # > Insert into universe
            has_replaced_existing = False
            for entity in ptr_entities:
                if (
                    entity.ds_yt_content
                    and entity.ds_yt_content.content_id == obj.content_id
                ):
                    entity.ds_yt_content = obj
                    has_replaced_existing = True
                    break

            if not has_replaced_existing:
                new_entity = Video(
                    _id=uuid4(),
                    file_hash=None,
                    file_path=None,
                    display_name=e_str(obj.title),
                    ds_yt_content=obj,
                )
                ptr_entities.append(new_entity)


__show_wait = False


def tab_import_export():
    global __show_wait
    # > YT Content
    if imgui.button("Import from: Youtube Content"):
        __show_wait = True
        match PLATFORM:
            case Platform.NATIVE:
                file_select_native(
                    dialog_title="Upload Youtube Content Report...",
                    file_filter_desc="Youtube Report (.csv)",
                    file_filter_match="*.csv",
                )
            case Platform.WEB:
                file_select_web(["text/csv"])
    if __show_wait:
        imgui.same_line()
        imgui.text("Processing...")
        if Universe.new_file_paths is not None:
            if len(Universe.new_file_paths) == 0:
                print("No file selected.")
            else:
                for path in Universe.new_file_paths:
                    upsert_yt_content_csv(Path(path), Universe.entities)
            __show_wait = False
            Universe.new_file_paths = None

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
                        Universe.entities,
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
                    )
                    Universe.entities.append(new_entity)
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
        _ = export_selection(Path(out_dir), Universe.entities)
