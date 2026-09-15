"""
Main Execution Pipeline for Training and Evaluating the Engagement Regression Model.
"""
import os
from typing import Optional, Dict, Any, Tuple
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
import joblib

from model_training.data_preparation import (
    prepare_training_data,
    FEATURE_COLUMNS,
    TARGET_COLUMN,
)
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


def load_model_artifacts(
    save_dir: Optional[str] = None,
    filename_prefix: str = "engagement_model",
) -> Tuple[Any, Any]:
    """Loads the linear regression and scaler from the saved inference bundle.

    Defaults to the committed bundle the server loads (config.ENGAGEMENT_MODEL_DIR).
    """
    if save_dir is None:
        from config import ENGAGEMENT_MODEL_DIR
        save_dir = ENGAGEMENT_MODEL_DIR

    bundle_path = os.path.join(save_dir, f"{filename_prefix}_inference.joblib")
    if not os.path.exists(bundle_path):
        raise FileNotFoundError(f"Inference bundle not found at {bundle_path}")

    bundle = joblib.load(bundle_path)
    return bundle["linear_regression"], bundle["scaler"]


def run_training_pipeline(
    raw_df: Optional[pd.DataFrame] = None,
    test_size: float = 0.2,
    random_state: int = 42,
    save_dir: Optional[str] = None,
    recommendation_threshold: float = 1.0,
) -> Dict[str, Any]:
    """
    Main programmatic execution pipeline for training the model.

    Parameters:
        raw_df: pandas DataFrame containing feature columns & target column.
        test_size: Ratio of test split (default 0.2).
        random_state: Random seed for train_test_split reproducibility.
        save_dir: Directory to write the inference bundle into. Nothing is written
            when None (the default); scripts/train_engagement_model.py passes the
            committed engagement_model/ directory.
        recommendation_threshold: Practical-effect threshold magnitude (default 1.0).

    Returns:
        Dict containing trained models, scaler, evaluation metrics, coefficients, and recommendations.
    """
    # 1 & 2 & 3. Clean and prepare data
    # Currently prepare_training_data is a placeholder function that returns a random DataFrame
    # TODO: Replace the placeholder function with the actual data preparation logic
    df = prepare_training_data(raw_df=raw_df)
    X = df[FEATURE_COLUMNS]
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
    coef_summary = get_coefficient_summary(model, FEATURE_COLUMNS)
    recommendations = generate_feature_recommendations(
        model, FEATURE_COLUMNS, threshold=recommendation_threshold
    )

    # 10. Persist the inference bundle if a directory is specified. It is the only
    # file written: the server loads nothing else, and the scaler and regression
    # it holds are no longer also saved as separate files.
    inference_path = None
    if save_dir:
        os.makedirs(save_dir, exist_ok=True)
        inference_path = os.path.join(save_dir, "engagement_model_inference.joblib")
        # One bundle keeps the prediction and feedback models from the same run.
        joblib.dump({
            "random_forest": random_forest,
            "linear_regression": model,
            "scaler": scaler,
            "feature_columns": list(FEATURE_COLUMNS),
            "recommendation_threshold": recommendation_threshold,
        }, inference_path)

    results = {
        "random_forest": random_forest,
        "random_forest_metrics": forest_metrics,
        "inference_path": inference_path,
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



if __name__ == "__main__":
    # A dry run: trains and prints metrics but writes nothing. To produce the
    # bundle the server loads, run scripts/train_engagement_model.py and commit it.
    from model_training.mock_data import generate_mock_training_data

    print("[ Test ] Generating mock dataset (200 samples)...")
    mock_df = generate_mock_training_data(num_samples=200, random_state=42)

    print("[ Test ] Running training pipeline...")
    run_training_pipeline(raw_df=mock_df, save_dir=None)

    print("\n[ Check Complete ] Model training executed successfully!")
    print("  Nothing was saved. Regenerate the bundle with: python scripts/train_engagement_model.py")
