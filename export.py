from datetime import datetime, timezone
from pathlib import Path

from typedef.dataset import ALL_DATASETS, Video
from utils import Failure, Result, Success


def export_selection(target_dir: Path, entities: list[Video]) -> Result[None, str]:
    ts_start = datetime.now(timezone.utc)
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
    print("[ Export ] Generating manifest...")
    manifest_path = out_dir / "manifest.csv"
    with manifest_path.open("w") as f:
        f.write("id,file_hash,display_name\n")
        manifest_text = (
            f"{ent._id},{ent.file_hash},{ent.display_name}\n" for ent in entities
        )
        f.writelines(manifest_text)
    print(f"[ Export ] Manifest complete at {manifest_path}")

    # > MARK: 4. Datasets
    print("[ Export ] Generating dataset folder...")
    data_dir = out_dir / "data"
    data_dir.mkdir()
    print(f"[ Export ] Dataset folder: {data_dir}")
    for DS in ALL_DATASETS:
        DS.export(data_dir, entities)
    print("[ Export ] Complete.")

    print("[ Export ] Export process complete.")
    return Success(None)
