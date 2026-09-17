"""Regenerates the committed engagement model bundle from a client export.

The server never trains (see inference.py): it loads
engagement_model/engagement_model_inference.joblib at startup. That file is
committed, and the Dockerfile and scripts/build_portable.py ship it as-is, so
nothing runs this during a build.

    python scripts/train_engagement_model.py EXPORT [--out DIR]

EXPORT is an `open-insights-export-<timestamp>` zip from the client's Export
step, or that zip unpacked into a folder. Only its manifest.json is read, so an
export with or without video files works the same. Each record needs Scan's
transcript stats and scene stats plus an imported YouTube content report (for
the average view duration); records missing any of those are skipped and
counted in the output. See model_training/data_preparation.py for exactly how
the features and target are computed.

There is deliberately no fallback dataset: a bundle must come from real data.
The split and both models are seeded, so the same export, code and pins always
produce the same model. The bundle records the export's name and row count
under "trained_on".

Run it, and commit the new bundle, whenever the committed one would go stale:
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
from model_training.data_preparation import load_export_dataset  # noqa: E402
from model_training.train import run_training_pipeline  # noqa: E402


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
        "--out",
        default=ENGAGEMENT_MODEL_DIR,
        help=f"directory to write the bundle into (default: {ENGAGEMENT_MODEL_DIR})",
    )
    args = parser.parse_args()

    try:
        raw_df = load_export_dataset(args.export)
    except (OSError, ValueError) as error:
        parser.error(str(error))

    results = run_training_pipeline(
        raw_df=raw_df, save_dir=args.out, dataset_name=args.export.name
    )
    print(f"\nEngagement model bundle ready at: {results['inference_path']}")


if __name__ == "__main__":
    main()
