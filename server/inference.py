"""Load the saved engagement model and predict from one video's features.

Create one EngagementPredictor during server startup and reuse it for requests.
"""

from collections.abc import Mapping
from math import isfinite
from numbers import Real
from pathlib import Path

import joblib
import pandas as pd

from config import ENGAGEMENT_MODEL_DIR
from model_training.data_preparation import FEATURE_COLUMNS, TARGET_COLUMN
from model_training.regression import FEATURE_DISPLAY_NAMES, generate_feature_recommendations


SERVER_DIR = Path(__file__).resolve().parent


class EngagementPredictor:
    """Use random forest for APV and linear regression for feature feedback."""

    def __init__(
        self,
        model_dir: str | Path = ENGAGEMENT_MODEL_DIR,
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
        """Return forest-predicted APV and, per feature, where this video sits.

        Each feature carries the dataset-level relationship from the linear
        regression, plus this video's value against the training average and a
        suggestion: "increase" or "decrease" when the video sits on the side of
        the average that the training data associates with lower APV, "keep"
        when it is already on the better side, "none" when the relationship is
        too weak to say. These are associations in the training data, not a
        causal explanation of the forest's prediction or a guaranteed improvement.

        Requires all FEATURE_COLUMNS as finite, nonnegative numbers, in the units
        the model was trained on: duration in minutes, scene_change_rate per
        minute, speech_pace_variation as a WPM standard deviation, speaking_ratio
        as a 0-1 fraction. Nothing is converted here. Invalid input raises
        ValueError for the API layer to handle as a 400.
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

        relationships = generate_feature_recommendations(
            self.linear_regression,
            FEATURE_COLUMNS,
            threshold=self.recommendation_threshold,
        )["features"]
        # The regression was fitted on standardised features, so a coefficient is
        # APV points per standard deviation - and coefficient * z is how far this
        # video's value moves the linear estimate from an average training video.
        standardised = self.scaler.transform(frame)[0]

        per_feature = {}
        for index, name in enumerate(FEATURE_COLUMNS):
            relationship = relationships[name]
            z = float(standardised[index])
            suggestion = _suggestion(relationship["relationship"], z)
            per_feature[name] = {
                **relationship,
                "value": row[name],
                "training_mean": float(self.scaler.mean_[index]),
                "z_score": z,
                "contribution": relationship["coefficient"] * z,
                "suggestion": suggestion,
                "advice": _advice(name, suggestion),
            }

        # Preserve the regression output rather than silently clipping its range.
        return {
            TARGET_COLUMN: prediction,
            "threshold": self.recommendation_threshold,
            "features": per_feature,
        }


def _suggestion(relationship: str, z: float) -> str:
    """Which way this video's value would have to move to sit where the training
    data sees higher APV. Only the sign of z matters: the threshold has already
    decided whether the relationship is worth acting on."""
    if relationship == "positive":
        return "increase" if z < 0 else "keep"
    if relationship == "negative":
        return "decrease" if z > 0 else "keep"
    return "none"


def _advice(name: str, suggestion: str) -> str:
    label = FEATURE_DISPLAY_NAMES.get(name, name.replace("_", " "))
    if suggestion == "increase":
        return (
            f"This video's {label} is below the training average; in the training "
            f"data, higher {label} is associated with higher average percentage viewed."
        )
    if suggestion == "decrease":
        return (
            f"This video's {label} is above the training average; in the training "
            f"data, lower {label} is associated with higher average percentage viewed."
        )
    if suggestion == "keep":
        return (
            f"This video's {label} is already on the side of the training average "
            f"that is associated with higher average percentage viewed."
        )
    return (
        f"In the training data, {label} has little to no measurable relationship "
        f"with average percentage viewed."
    )
