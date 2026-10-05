"""Trains an engagement model from a client export, into the repository's models/.

The server never trains (see inference.py): it loads the models committed under
the repository's models/<id>/ (model.joblib + model.json) that BUILTIN_MODELS
names, and the Dockerfile and scripts/build_portable.py ship them as-is, so
nothing runs this during a build.

    python scripts/train_engagement_model.py EXPORT [--feature-set full|fast|video|audio]
        [--out DIR | --no-save] [--package FILE.zip] [--name ...] [--provider ...] [--notes ...]

EXPORT is an `open-insights-export-<timestamp>` zip from the client's Export
step, or that zip unpacked into a folder. Only its manifest.json is read, so an
export with or without video files works the same. Each record needs the Scan
results its feature set is computed from (all four scans for "full"; see
FEATURE_SETS in model_training/data_preparation.py) plus an imported YouTube
content report (for the average view duration); records missing any of those are
skipped and counted in the output.

By default the model is written to models/<id>/ (the id defaults to the feature
set's name). --package also writes a .zip that anyone can add to their own server
from its page (http://localhost:5000/); scripts/package_model.py makes the same
.zip from a model already committed, without retraining.

There is deliberately no fallback dataset: a model must come from real data.
The split and both models are seeded, so the same export, code and pins always
produce the same model. The model card (model.json) records the export's name,
the split, held-out metrics and package versions.

Run it, and commit the new models, whenever the committed ones would go stale:
  - there is a better or larger export to learn from,
  - scikit-learn, numpy, pandas or joblib change in requirements.txt - a
    scikit-learn pickle does not load reliably under another version - or
  - anything in model_training/ that shapes the models changes.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import ENGAGEMENT_MODEL_DIR  # noqa: E402
from model_training.data_preparation import FEATURE_SETS, load_export_dataset  # noqa: E402
from model_training.train import run_training_pipeline  # noqa: E402

# What the published models were trained on, and so what they can speak for.
DEFAULT_NOTES = (
    "Trained on 144 engineering lecture recordings from two University of Newcastle "
    "courses (MECH1750 and ENGG2440 - the EduVideo Insights set, see "
    "data/sample/edu-video-insights/COMPARISON.md). Predictions for other kinds of "
    "video are extrapolation. The per-feature suggestions are associations in that "
    "data, not causes."
)

# What each published model is called and for, unless overridden on the command line.
DEFAULT_META = {
    "full": (
        "Full features",
        "All eight features: transcript, scene, on-screen text and audio. The most "
        "information, and the slowest to scan for.",
    ),
    "fast": (
        "Fast features",
        "Every feature except on-screen text, so the slow OCR scan is never needed. "
        "Transcript, scene and audio stats only.",
    ),
    "video": (
        "Video only",
        "Duration, scene change rate and on-screen text - what can be seen, not heard.",
    ),
    "audio": (
        "Audio only",
        "Duration plus the transcript and audio features - what can be heard, not seen.",
    ),
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "export",
        type=Path,
        help="client export to train on: an open-insights-export-*.zip or its unpacked folder",
    )
    parser.add_argument(
        "--feature-set",
        choices=sorted(FEATURE_SETS),
        default="full",
        help="which features the model learns from; also its default id (default: full)",
    )
    parser.add_argument("--id", help="model id (default: the feature set's name)")
    parser.add_argument("--name", help="display name")
    parser.add_argument("--version", default="1", help="model version (default: 1)")
    parser.add_argument("--description", help="one or two sentences on what it is for")
    parser.add_argument("--provider", default="Open Insights", help="who trained it")
    parser.add_argument("--provider-url", default="", help="where to find out more about them")
    parser.add_argument(
        "--notes",
        default=DEFAULT_NOTES,
        help="anything a user should know before using it (default: a note on the lecture data)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help=f"directory to write model.joblib + model.json into "
        f"(default: {ENGAGEMENT_MODEL_DIR}/<id>)",
    )
    parser.add_argument(
        "--no-save", action="store_true", help="do not write a model directory (use with --package)"
    )
    parser.add_argument("--package", type=Path, help="also write a model package .zip here")
    args = parser.parse_args()

    model_id = args.id or args.feature_set
    default_name, default_description = DEFAULT_META.get(args.feature_set, (model_id, ""))
    meta = {
        "id": model_id,
        "name": args.name or default_name,
        "version": args.version,
        "description": args.description or default_description,
        "provider": {"name": args.provider, "url": args.provider_url},
        "notes": args.notes,
    }
    features = FEATURE_SETS[args.feature_set]

    try:
        raw_df = load_export_dataset(args.export, features=features)
    except (OSError, ValueError) as error:
        parser.error(str(error))

    out = None if args.no_save else (args.out or Path(ENGAGEMENT_MODEL_DIR) / model_id)
    results = run_training_pipeline(
        raw_df=raw_df,
        save_dir=str(out) if out else None,
        dataset_name=args.export.name,
        features=features,
        meta=meta,
        package_path=str(args.package) if args.package else None,
    )
    forest = results["card"]["metrics"]["random_forest"]
    print(f"\nRandom forest on held-out rows: RMSE {forest['rmse']:.3f}, R² {forest['r2']:.3f}")
    if results["inference_path"]:
        print(f"Model ready at: {Path(results['inference_path']).parent}")
    if results["package_path"]:
        print(f"Package ready at: {results['package_path']}")


if __name__ == "__main__":
    main()
