"""Packages a committed model so it can be shared and added to another server.

    python scripts/package_model.py ../models/video -o dist/models/video.zip

A model package is a .zip of exactly model.json and model.joblib, which is what
the "Add a model" forms on a server's page (http://localhost:5000/) accept. This
copies the committed files as they are rather than retraining, so the package is
the same model the repository tests and ships. Print its SHA-256 so whoever
publishes it can give that alongside the link.
"""

import argparse
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from model_training.train import package_directory  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("model_dir", type=Path, help="a model directory, e.g. ../models/video")
    parser.add_argument(
        "-o", "--out", type=Path, help="the .zip to write (default: dist/models/<id>.zip)"
    )
    args = parser.parse_args()

    out = args.out or Path("dist/models") / f"{args.model_dir.resolve().name}.zip"
    try:
        card = package_directory(str(args.model_dir), str(out))
    except (OSError, ValueError) as error:
        parser.error(str(error))

    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"Packaged {card.get('name')} ({card.get('id')}) at {out}")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    main()
