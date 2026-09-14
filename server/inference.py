"""Load the saved engagement model and predict from one video's features.

Create one EngagementPredictor during server startup and reuse it for requests.
"""

from collections.abc import Mapping
from math import isfinite
from numbers import Real
from pathlib import Path

import joblib
import pandas as pd

from model_training.data_preparation import FEATURE_COLUMNS, TARGET_COLUMN
from model_training.regression import generate_feature_recommendations


SERVER_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL_DIR = SERVER_DIR / "models"


class EngagementPredictor:
    """Use random forest for APV and linear regression for dataset-level feedback."""

    def __init__(
        self,
        model_dir: str | Path = DEFAULT_MODEL_DIR,
        filename_prefix: str = "engagement_model",
    ) -> None:
        # Resolve relative paths against server/, independently of the launch directory.
        model_dir = Path(model_dir)
        if not model_dir.is_absolute():
            model_dir = SERVER_DIR / model_dir

        # Missing artifacts raise FileNotFoundError; inference never trains a replacement.
        bundle = joblib.load(model_dir / f"{filename_prefix}_inference.joblib") 
        if bundle["feature_columns"] != list(FEATURE_COLUMNS):
            raise ValueError("Saved model features do not match the inference feature schema.")
        self.model = bundle["random_forest"]
        self.linear_regression = bundle["linear_regression"]
        self.scaler = bundle["scaler"]
        self.recommendation_threshold = bundle["recommendation_threshold"]

    def predict(self, features: Mapping[str, object]) -> dict[str, object]:
        """Return forest-predicted APV and linear-regression feature associations.

        Feedback describes the training dataset, not a causal explanation of
        this video's forest prediction or a guaranteed improvement.

        Requires duration, wpm, scene_change_rate, and word_count as finite,
        nonnegative numbers. Units must match the data used to train the model;
        this function does not convert duration or scene-change-rate units.
        Invalid input raises ValueError for the API layer to handle as a 400.
        """
        if not isinstance(features, Mapping):
            raise ValueError("Features must be an object containing video feature values.")

        missing = [name for name in FEATURE_COLUMNS if name not in features]
        if missing:
            raise ValueError(f"Missing required feature(s): {', '.join(missing)}")

        row = {}
        for name in FEATURE_COLUMNS:
            value = features[name]
            if isinstance(value, bool) or not isinstance(value, Real):
                raise ValueError(f"{name} must be a finite, nonnegative number.")
            try:
                number = float(value)
            except (OverflowError, ValueError) as exc:
                raise ValueError(f"{name} must be a finite, nonnegative number.") from exc
            if not isfinite(number) or number < 0:
                raise ValueError(f"{name} must be a finite, nonnegative number.")
            row[name] = number

        frame = pd.DataFrame([row], columns=FEATURE_COLUMNS)
        prediction = float(self.model.predict(frame)[0])
        if not isfinite(prediction):
            raise RuntimeError("The engagement model returned a non-finite prediction.")

        # Preserve the regression output rather than silently clipping its range.
        return {
            TARGET_COLUMN: prediction,
            "recommendations": generate_feature_recommendations(
                self.linear_regression,
                FEATURE_COLUMNS,
                threshold=self.recommendation_threshold,
            ),
        }
