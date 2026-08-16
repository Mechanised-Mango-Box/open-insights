from utils import DatasetWhisperTranscript
from utils import DatasetOpenCVSceneStats
from utils import DatasetYoutubeAudienceRetention
from dataclasses import fields
from dataclasses import asdict
from datetime import datetime
from utils import Success
from utils import Failure
from utils import Result
from pathlib import Path
from uuid import UUID
import uuid
from dataclasses import astuple
from enum import auto
from enum import Enum
from utils import ID
from typing_extensions import Set
from gui.tables import smart_table
from utils import file_hash
from typing_extensions import List
from utils import Video
from utils import DatasetYoutubeContent
import csv
from imgui_bundle import portable_file_dialogs as pfd
from imgui_bundle import imgui
from universe import Universe


class TableSelectMode(Enum):
    NONE = auto()
    SINGLE = auto()
    MULTIPLE = auto()


__selected_ids: Set[UUID] = set()


def build_page(u: Universe):
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
            print((u.entities))
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
                    filter(lambda entity: is_same_hash(entity, selected_hash), u.entities)
                )
                print(matching)

                if len(matching) <= 0:
                    # * None match, insert new
                    new_entity = Video(
                        _id=uuid.uuid4(),
                        file_hash=selected_hash,
                        file_path=path,
                        display_name=path.stem,
                    )  # TODO make file the name not the whole path
                    u.entities.append(new_entity)
                else:
                    # * Update
                    for matching_entity in matching:
                        print("MATCH", selected_hash)
        print(u.entities)

    if imgui.button("Export"):
        out_dir = pfd.select_folder(
            "Select export location...",
            ".",
            options=pfd.opt.none,
        ).result()
        export(Path(out_dir), u.entities)

    element_id: str = "fsfes"
    # * Rows
    rows = u.entities
    # column_flags: List[int],
    # on_update_row: Callable[[None], None],
    # * Selection
    selected_ids: Set[UUID] = __selected_ids
    table_select_mode: TableSelectMode = TableSelectMode.MULTIPLE
    # * Events
    # on_double_click: Optional[Callable[[Rowable, bool], None]]

    show_select_box = table_select_mode is not TableSelectMode.NONE

    table_flags = (
        imgui.TableFlags_.borders
        | imgui.TableFlags_.row_bg
        | imgui.TableFlags_.resizable
        | imgui.TableFlags_.sort_tristate
        | imgui.TableFlags_.sort_multi
        | imgui.TableFlags_.sortable
    )

    # > Construct Table
    if imgui.begin_table(element_id, 8 + (1 if show_select_box else 0), table_flags):
        # > Generate Headers
        if show_select_box:
            imgui.table_setup_column(
                "",
                imgui.TableColumnFlags_.no_sort
                | imgui.TableColumnFlags_.no_resize
                | imgui.TableColumnFlags_.width_fixed,
            )

        imgui.table_setup_column("ID")
        imgui.table_setup_column("Title")
        imgui.table_setup_column("File Hash")
        imgui.table_setup_column("File Handle")
        imgui.table_setup_column("YT Content")
        imgui.table_setup_column("YT Audience Retention")
        imgui.table_setup_column("Transcript")
        imgui.table_setup_column("Scene Stats")
        imgui.table_headers_row()

        for row in rows:
            imgui.table_next_row()
            in_selected = row._id in selected_ids
            if show_select_box:
                imgui.table_next_column()

                clicked_checkbox, _ = imgui.checkbox(
                    f"##{element_id}/checkboxes/{row._id}", in_selected
                )
                if clicked_checkbox:
                    if in_selected:
                        selected_ids.remove(row._id)
                    else:
                        if table_select_mode is not TableSelectMode.MULTIPLE:
                            # ? if single select, always clear selection
                            selected_ids.clear()
                        selected_ids.add(row._id)

            imgui.table_next_column()
            _, _ = imgui.selectable(
                f"{row._id}##{element_id}/rows/{row._id}",
                in_selected,
                imgui.SelectableFlags_.span_all_columns
                | imgui.SelectableFlags_.no_auto_close_popups,
            )

            # if on_double_click is not None:
            #     on_double_click(row, imgui.is_item_hovered() and imgui.is_mouse_double_clicked(0))
            imgui.table_next_column()
            imgui.text(str(row.display_name))
            imgui.table_next_column()
            imgui.text(str(row.file_hash))
            imgui.table_next_column()
            imgui.text(str(row.file_path))
            imgui.table_next_column()
            imgui.text(str(row.ds_yt_content))
            imgui.table_next_column()
            imgui.text(str(row.ds_yt_audience_retention))
            imgui.table_next_column()
            imgui.text(str(row.ds_whisper_transcript))
            imgui.table_next_column()
            imgui.text(str(row.ds_opencv_scene_stats))

    imgui.end_table()


def upsert_yt_content_csv(path: str, ptr_entities: List[Video]):
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)  # columns become dict keys
        for row in reader:
            # > Read as obj
            obj = DatasetYoutubeContent(
                yt_id=row["Content"],
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
                    if (x := row["Impressions click-through rate (%)"]) is not None and ""
                    else None
                ),
            )

            # >  Insert into universe
            has_repalced_existing = False
            for entity in ptr_entities:
                # > Same ID -> replace
                if entity.ds_yt_content and entity.ds_yt_content.yt_id == obj.yt_id:
                    entity.ds_yt_content = obj
                    has_repalced_existing = True
                    break

            if not has_repalced_existing:
                new_entity = Video(
                    _id=uuid.uuid4(),
                    file_hash=None,
                    file_path=None,
                    display_name=obj.title,
                    ds_yt_content=obj,
                )
                ptr_entities.append(new_entity)


def export(target_dir: Path, entities: List[Video]) -> Result[None, str]:
    ts_start = datetime.now()
    ts_start_iso = ts_start.isoformat()
    print(
        f"""[ Export] Starting export at {ts_start_iso}.
    \t> Target: {target_dir}
    \t> Count: {len(entities)}"""
    )

    # > MARK: 1. Validation
    if len(entities) <= 0:
        return Failure("No entities selected.")
    if not (target_dir.exists(), target_dir.is_dir()):
        return Failure(f"Path provided is invalid: {target_dir}")

    # > MARK: 2. Make export folder
    print("[ Export ] Generating output folder...")
    out_dir = target_dir / ts_start_iso
    out_dir.mkdir()
    print(f"[ Export ] Output folder: {out_dir}")

    # > MARK: 3. Generate manifest
    print(f"[ Export ] Generating manifest...")
    manifest_path = out_dir / "manifest.csv"
    with manifest_path.open("w") as f:
        f.writelines("id,file_hash,display_name\n")
        manifest_text = map(lambda ent: f"{ent._id},{ent.file_hash},{ent.display_name}\n", entities)
        f.writelines(manifest_text)
    print(f"[ Export ] Manifest complete at {manifest_path}")

    # > MARK: 4. Datasets
    print("[ Export ] Generating dataset folder...")
    data_dir = out_dir / "data"
    data_dir.mkdir()
    print(f"[ Export ] Dataset folder: {data_dir}")

    # > MARK: 4.x Youtube - Content
    print("[ Export ] Generating: Youtube Content...")
    yt_content_path = data_dir / (DatasetYoutubeContent.get_label() + ".csv")
    with yt_content_path.open("w") as f:
        writer = csv.DictWriter(f, fieldnames=DatasetYoutubeContent.get_fieldnames())
        f.writelines("id,")
        writer.writeheader()
        for entity in entities:
            data = entity.ds_yt_content
            if not data:
                continue
            f.writelines(str(entity._id) + ",")
            writer.writerow(asdict(data))
    print(f"[ Export ] Youtube Content complete at {yt_content_path}")

    # > MARK: 4.x Youtube - Audience Retention
    # TODO
    # > MARK: 4.x Whisper - Transcript
    print("[ Export ] Generating: Whisper - Transcript...")
    print("[ Export ] Generating folder...")
    transcript_dir = data_dir / DatasetWhisperTranscript.get_label()
    transcript_dir.mkdir()
    print(f"[ Export ] Folder: {transcript_dir}")
    for entity in entities:
        whisper_transcript = entity.ds_whisper_transcript
        if not whisper_transcript:
            continue

        print(f"[ Export ] Exporting transcript for {entity._id}")

        curr_file_path = transcript_dir / (str(entity._id) + ".txt")
        with curr_file_path.open("w") as f:
            f.writelines(whisper_transcript.transcript)

    # > MARK: 4.x Transcript Stats
    # TODO
    # > MARK: 4.x OpenCV - Scene Stats
    # TODO

    return Success(None)
