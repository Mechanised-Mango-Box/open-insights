"""
Main Execution Pipeline for Training and Evaluating the Engagement Regression Model.
"""
import os
from typing import Optional, Dict, Any, Tuple
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
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
)
from model_training.evaluation import (
    evaluate_model,
    format_evaluation_report,
)


def save_model_artifacts(
    model: Any,
    scaler: Any,
    save_dir: str = "models",
    filename_prefix: str = "engagement_model",
) -> Tuple[str, str]:
    """Saves fitted model and scaler to disk using joblib."""
    os.makedirs(save_dir, exist_ok=True)

    model_path = os.path.join(save_dir, f"{filename_prefix}.joblib")
    scaler_path = os.path.join(save_dir, f"{filename_prefix}_scaler.joblib")

    joblib.dump(model, model_path)
    joblib.dump(scaler, scaler_path)

    print(f"[ Model Training ] Saved model to: {model_path}")
    print(f"[ Model Training ] Saved scaler to: {scaler_path}")
    return model_path, scaler_path


def load_model_artifacts(
    save_dir: str = "models",
    filename_prefix: str = "engagement_model",
) -> Tuple[Any, Any]:
    """Loads saved model and scaler from disk using joblib."""
    model_path = os.path.join(save_dir, f"{filename_prefix}.joblib")
    scaler_path = os.path.join(save_dir, f"{filename_prefix}_scaler.joblib")

    if not os.path.exists(model_path) or not os.path.exists(scaler_path):
        raise FileNotFoundError(f"Model artifacts not found in {save_dir}")

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path)
    return model, scaler


def run_training_pipeline(
    raw_df: Optional[pd.DataFrame] = None,
    test_size: float = 0.2,
    random_state: int = 42,
    save_dir: Optional[str] = "models",
) -> Dict[str, Any]:
    """
    Main programmatic execution pipeline for training the model.

    Parameters:
        raw_df: pandas DataFrame containing feature columns & target column.
        test_size: Ratio of test split (default 0.2).
        random_state: Random seed for train_test_split reproducibility.
        save_dir: Directory path to persist trained model and scaler (Optional).

    Returns:
        Dict containing trained model, scaler, evaluation metrics, and summary.
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

    # 8. Predict on test set
    y_pred = predict_engagement(model, scaler, X_test)

    # 9. Evaluate model performance
    metrics = evaluate_model(y_test, y_pred)
    coef_summary = get_coefficient_summary(model, FEATURE_COLUMNS)

    # 10. Persist model artifacts if directory specified
    model_path, scaler_path = None, None
    if save_dir:
        model_path, scaler_path = save_model_artifacts(model, scaler, save_dir=save_dir)

    results = {
        "model": model,
        "scaler": scaler,
        "metrics": metrics,
        "coefficients": coef_summary,
        "model_path": model_path,
        "scaler_path": scaler_path,
    }

    print(format_evaluation_report(metrics))
    print(f"Intercept & Coefficients:\n  {coef_summary}")

    return results
