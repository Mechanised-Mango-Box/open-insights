"""The model card: what an engagement model is, said in plain JSON.

Every model is saved as two files side by side - model.joblib (the pickled
models inference.py loads) and model.json (this card). The card is what the
server's page and the client's Recommend step show about a model, and it is read
without unpickling anything: a pickle can run code when loaded, so a model's
description has to be readable before anyone decides to trust it.

A model package (what the server's page accepts, and what the published models
are downloaded as) is a .zip holding exactly those two files.

The card is also embedded in the bundle, under "card", so the two cannot be
separated without the server noticing (see model_registry.py).
"""
import importlib.metadata
import platform
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

CARD_FORMAT_VERSION = 1

BUNDLE_FILENAME = "model.joblib"
CARD_FILENAME = "model.json"

# Lower-case letters, digits, '-' and '_': safe as a directory name on every
# platform and in a URL query string.
MODEL_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

# The packages whose versions decide whether a pickle loads (scikit-learn above
# all - its pickles do not load reliably under another version).
FRAMEWORK_PACKAGES = ("scikit-learn", "numpy", "pandas", "joblib")


def framework_versions() -> Dict[str, str]:
    versions = {"python": platform.python_version()}
    for name in FRAMEWORK_PACKAGES:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "missing"
    return versions


def build_card(
    *,
    meta: Dict[str, Any],
    features: List[str],
    feature_definitions: Dict[str, str],
    target: str,
    target_definition: str,
    training: Dict[str, Any],
    metrics: Dict[str, Dict[str, float]],
    hyperparameters: Dict[str, Any],
    feature_importances: Dict[str, float],
    coefficients: Dict[str, float],
    intercept: float,
    recommendation_threshold: float,
    created_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Assembles a card. `meta` carries what only the person training it can say:
    id, name, version, description, provider {name, url}, notes."""
    provider = meta.get("provider") or {}
    return {
        "format_version": CARD_FORMAT_VERSION,
        "id": meta["id"],
        "name": meta.get("name") or meta["id"],
        "version": meta.get("version") or "1",
        "created_at": created_at
        or datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "description": meta.get("description") or "",
        "provider": {"name": provider.get("name") or "", "url": provider.get("url") or ""},
        "notes": meta.get("notes") or "",
        "model_type": {
            "predictor": "RandomForestRegressor",
            "predictor_role": "Predicts average percentage viewed from the raw feature values.",
            "feedback": "LinearRegression on standardised features",
            "feedback_role": (
                "Gives each feature's direction and strength of association with "
                "average percentage viewed, used for the per-feature suggestions."
            ),
        },
        "hyperparameters": hyperparameters,
        "features": list(features),
        "feature_definitions": {name: feature_definitions[name] for name in features},
        "target": target,
        "target_definition": target_definition,
        "training": training,
        "metrics": metrics,
        "feature_importances": feature_importances,
        "coefficients": coefficients,
        "intercept": intercept,
        "recommendation_threshold": recommendation_threshold,
        "framework": framework_versions(),
    }


def validate_card(card: Any) -> List[str]:
    """Everything wrong with a card's shape, or [] when it is usable. Says nothing
    about whether this server can run the model - see model_registry.problems()."""
    if not isinstance(card, dict):
        return ["model.json is not a JSON object."]
    errors = []
    if card.get("format_version") != CARD_FORMAT_VERSION:
        errors.append(
            f"Unsupported format_version {card.get('format_version')!r} "
            f"(this server reads {CARD_FORMAT_VERSION})."
        )
    model_id = card.get("id")
    if not isinstance(model_id, str) or not MODEL_ID_PATTERN.match(model_id):
        errors.append(
            "id must be 1-64 lower-case letters, digits, '-' or '_', starting with a letter or digit."
        )
    for key in ("name", "version", "created_at"):
        if not isinstance(card.get(key), str) or not card.get(key):
            errors.append(f"{key} must be a non-empty string.")
    features = card.get("features")
    if (
        not isinstance(features, list)
        or not features
        or not all(isinstance(name, str) for name in features)
        or len(set(features)) != len(features)
    ):
        errors.append("features must be a non-empty list of distinct feature names.")
    threshold = card.get("recommendation_threshold")
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
        errors.append("recommendation_threshold must be a number.")
    if not isinstance(card.get("framework"), dict):
        errors.append("framework must be an object of package versions.")
    return errors
