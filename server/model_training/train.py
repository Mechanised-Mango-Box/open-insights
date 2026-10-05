"""
Main Execution Pipeline for Training and Evaluating the Engagement Regression Model.
"""
import json
import os
import zipfile
from typing import Optional, Dict, Any, List, Tuple
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
import joblib

from model_training.data_preparation import (
    prepare_training_data,
    FEATURE_COLUMNS,
    FEATURE_DEFINITIONS,
    TARGET_COLUMN,
    TARGET_DEFINITION,
)
from model_training.model_card import BUNDLE_FILENAME, CARD_FILENAME, build_card
from model_training.regression import (
    fit_scaler_and_train_model,
    predict_engagement,
    get_coefficient_summary,
    generate_feature_recommendations,
)
from model_training.evaluation import (
    evaluate_model,
    format_evaluation_report,
)


def load_model_artifacts(save_dir: Optional[str] = None) -> Tuple[Any, Any]:
    """Loads the linear regression and scaler from a saved model directory.

    Defaults to the committed default model the server loads
    (config.ENGAGEMENT_MODEL_DIR / config.ENGAGEMENT_MODEL_DEFAULT).
    """
    if save_dir is None:
        from config import ENGAGEMENT_MODEL_DEFAULT, ENGAGEMENT_MODEL_DIR
        save_dir = os.path.join(ENGAGEMENT_MODEL_DIR, ENGAGEMENT_MODEL_DEFAULT)

    bundle_path = os.path.join(save_dir, BUNDLE_FILENAME)
    if not os.path.exists(bundle_path):
        raise FileNotFoundError(f"Inference bundle not found at {bundle_path}")

    bundle = joblib.load(bundle_path)
    return bundle["linear_regression"], bundle["scaler"]


def run_training_pipeline(
    raw_df: pd.DataFrame,
    test_size: float = 0.2,
    random_state: int = 42,
    save_dir: Optional[str] = None,
    recommendation_threshold: float = 1.0,
    dataset_name: Optional[str] = None,
    features: Optional[List[str]] = None,
    meta: Optional[Dict[str, Any]] = None,
    package_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main programmatic execution pipeline for training the model.

    Parameters:
        raw_df: pandas DataFrame containing feature columns & target column, e.g. from
            model_training.data_preparation.load_export_dataset().
        test_size: Ratio of test split (default 0.2).
        random_state: Random seed for train_test_split reproducibility.
        save_dir: Directory to write the inference bundle into. Nothing is written
            when None (the default); scripts/train_engagement_model.py passes the
            committed engagement_model/ directory.
        recommendation_threshold: Practical-effect threshold magnitude (default 1.0).
        dataset_name: What the data came from (an export's name), recorded in the
            model card so a committed model says what it was trained on.
        features: The feature columns to learn from (default: all of FEATURE_COLUMNS).
        meta: The card's id, name, version, description, provider and notes (see
            model_training/model_card.py). Defaults to an id of "model".
        package_path: Also write a model package - a .zip of model.json and
            model.joblib, which the server's page can add - to this path.

    Returns:
        Dict containing trained models, scaler, evaluation metrics, coefficients, and recommendations.
    """
    # 1 & 2 & 3. Validate and narrow to the feature and target columns
    features = list(features or FEATURE_COLUMNS)
    df = prepare_training_data(raw_df=raw_df, features=features)
    X = df[features]
    y = df[TARGET_COLUMN]

    # 4. Split data into training and test sets
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state
    )

    # 5, 6, 7. Standardise features & train model
    model, scaler = fit_scaler_and_train_model(X_train, y_train)

    # Both models learn from the same training split. The forest uses raw features.
    random_forest = RandomForestRegressor(random_state=random_state)
    random_forest.fit(X_train, y_train)
    forest_metrics = evaluate_model(y_test, random_forest.predict(X_test))

    # 8. Predict on test set
    y_pred = predict_engagement(model, scaler, X_test)

    # 9. Evaluate model performance & feature relationships
    metrics = evaluate_model(y_test, y_pred)
    coef_summary = get_coefficient_summary(model, features)
    recommendations = generate_feature_recommendations(
        model, features, threshold=recommendation_threshold
    )

    # 10. Describe the run. The export itself lives outside the repo, so the card
    # is the one record of what a committed model learned from and how well it
    # did on the rows it never saw.
    forest_params = random_forest.get_params()
    card = build_card(
        meta=meta or {"id": "model"},
        features=features,
        feature_definitions=FEATURE_DEFINITIONS,
        target=TARGET_COLUMN,
        target_definition=TARGET_DEFINITION,
        training={
            "dataset": dataset_name,
            "rows": len(df),
            "train_rows": len(X_train),
            "test_rows": len(X_test),
            "test_size": test_size,
            "random_state": random_state,
            "split": "Random train/test split; metrics are on the held-out test rows.",
        },
        metrics={
            "random_forest": {k: float(v) for k, v in forest_metrics.items()},
            "linear_regression": {k: float(v) for k, v in metrics.items()},
        },
        hyperparameters={
            key: forest_params[key]
            for key in (
                "n_estimators",
                "max_depth",
                "min_samples_split",
                "min_samples_leaf",
                "max_features",
                "bootstrap",
                "random_state",
            )
        },
        feature_importances={
            name: float(value)
            for name, value in zip(features, random_forest.feature_importances_)
        },
        coefficients=coef_summary["coefficients"],
        intercept=coef_summary["intercept (b0)"],
        recommendation_threshold=recommendation_threshold,
    )

    # 11. Persist the model if a directory is specified: the bundle the server
    # unpickles and the card it shows without unpickling. One bundle keeps the
    # prediction and feedback models from the same run.
    bundle = {
        "random_forest": random_forest,
        "linear_regression": model,
        "scaler": scaler,
        "feature_columns": features,
        "recommendation_threshold": recommendation_threshold,
        "card": card,
    }
    inference_path = None
    if save_dir:
        os.makedirs(save_dir, exist_ok=True)
        inference_path = os.path.join(save_dir, BUNDLE_FILENAME)
        joblib.dump(bundle, inference_path)
        with open(os.path.join(save_dir, CARD_FILENAME), "w", encoding="utf-8") as f:
            json.dump(card, f, indent=2)
            f.write("\n")

    if package_path:
        write_package(bundle, card, package_path)

    results = {
        "random_forest": random_forest,
        "random_forest_metrics": forest_metrics,
        "inference_path": inference_path,
        "package_path": package_path,
        "card": card,
        "model": model,
        "scaler": scaler,
        "metrics": metrics,
        "coefficients": coef_summary,
        "recommendations": recommendations,
    }

    print(format_evaluation_report(metrics))
    print(f"Intercept & Coefficients:\n  {coef_summary}")
    print(f"\nFeature Relationship Recommendations (threshold = {recommendation_threshold}):")
    for feat, data in recommendations["features"].items():
        print(f"  [{feat}] coef={data['coefficient']:+.4f} -> {data['relationship'].upper()}")
        print(f"    Recommendation: {data['recommendation']}")

    return results


def write_package(bundle: Dict[str, Any], card: Dict[str, Any], package_path: str) -> None:
    """Writes a model package: a .zip of exactly model.json and model.joblib."""
    import io

    buffer = io.BytesIO()
    joblib.dump(bundle, buffer)
    os.makedirs(os.path.dirname(os.path.abspath(package_path)), exist_ok=True)
    with zipfile.ZipFile(package_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(CARD_FILENAME, json.dumps(card, indent=2) + "\n")
        archive.writestr(BUNDLE_FILENAME, buffer.getvalue())


if __name__ == "__main__":
    # A dry run: trains on an export and prints metrics but writes nothing. To
    # produce the bundle the server loads, run scripts/train_engagement_model.py
    # and commit it.
    import sys
    from model_training.data_preparation import load_export_dataset

    if len(sys.argv) != 2:
        sys.exit("usage: python -m model_training.train <export folder or .zip>")

    run_training_pipeline(raw_df=load_export_dataset(sys.argv[1]), save_dir=None)

    print("\n[ Check Complete ] Model training executed successfully!")
    print(
        "  Nothing was saved. Regenerate the bundle with: "
        "python scripts/train_engagement_model.py <export>"
    )
