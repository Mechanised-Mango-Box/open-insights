"""
Evaluation Module for Model Performance.

Metrics:
    - Root Mean Square Error (RMSE): Measures the average difference between the predicted and actual values.
    - R-squared (R^2): Measures how much variation in engagement is explained by the model.
"""
from typing import Dict, Any
import numpy as np
from sklearn.metrics import mean_squared_error, r2_score


def evaluate_model(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """
    Computes evaluation metrics RMSE and R-squared.

    Parameters:
        y_true: Ground truth target values.
        y_pred: Predicted target values from model.

    Returns:
        Dict containing 'rmse' and 'r2'.
    """
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = r2_score(y_true, y_pred)

    return {
        "rmse": rmse,
        "r2": r2,
    }


def format_evaluation_report(metrics: Dict[str, float]) -> str:
    """Formats metrics dictionary into a readable string summary."""
    return (
        f"--- Model Evaluation Results ---\n"
        f"  Root Mean Square Error (RMSE): {metrics['rmse']:.4f}\n"
        f"  R-squared (R²):               {metrics['r2']:.4f}\n"
    )