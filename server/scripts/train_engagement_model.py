"""Trains the engagement model bundle the server loads at startup.

The server never trains (see inference.py) and fails to boot without the bundle,
so this has to run first: by hand after cloning, and as a build step in the
Dockerfile and scripts/build_portable.py. Running it at build time rather than
committing the pickle is what keeps the bundle's scikit-learn version the same
as the one that loads it - sklearn pickles are not portable across versions.

Trains on generated mock data for now: extract_features_from_snapshot() in
model_training/data_preparation.py is still unimplemented. Seeded, so every
build produces the same model.

    python scripts/train_engagement_model.py [--out DIR]
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import ENGAGEMENT_MODEL_DIR  # noqa: E402
from model_training.mock_data import generate_mock_training_data  # noqa: E402
from model_training.train import run_training_pipeline  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=ENGAGEMENT_MODEL_DIR,
        help=f"directory to write the bundle into (default: {ENGAGEMENT_MODEL_DIR})",
    )
    args = parser.parse_args()

    raw_df = generate_mock_training_data(num_samples=200, random_state=42)
    results = run_training_pipeline(raw_df=raw_df, save_dir=args.out)
    print(f"\nEngagement model bundle ready at: {results['inference_path']}")


if __name__ == "__main__":
    main()
