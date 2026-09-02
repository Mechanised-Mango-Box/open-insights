"""
Model Visualization Module for Post-Training Model Analysis.

This module provides post-training visualizations comparing actual vs. predicted engagement
by standardized feature (Z-score), using pre-trained model artifacts loaded via joblib.
"""
from typing import Optional, List, Any, Dict
import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from model_training.data_preparation import (
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    prepare_training_data,
)
from model_training.train import load_model_artifacts
from model_training.regression import predict_engagement

# Display names for human-readable plotting
FEATURE_DISPLAY_NAMES: Dict[str, str] = {
    "duration": "Duration in minutes",
    "word_count": "Total number of words",
    "wpm": "Average speaking speed (wpm)",
    "scene_count": "Total number of scenes",
    "scene_change_rate": "Average scenes change rate (spm)",
}


def plot_actual_vs_predicted(
    X_scaled: Any,
    y_actual: Any,
    y_pred: Any,
    features: Optional[List[str]] = None,
    target_name: str = "Average Percentage Viewed",
    save_path: Optional[str] = None,
) -> plt.Figure:
    """
    Plots a scatter plot for each standardized feature (Z-score on x-axis centered at 0),
    comparing Actual vs. Predicted target values using circle markers with different colors.

    Parameters:
        X_scaled: Z-score standardized feature matrix (numpy array or DataFrame).
        y_actual: Actual ground-truth target values.
        y_pred: Model predicted target values.
        features: Feature column names. Defaults to FEATURE_COLUMNS.
        target_name: Name of target metric for y-axis label.
        save_path: Optional file path to save figure.

    Returns:
        Matplotlib Figure object.
    """
    if features is None:
        features = FEATURE_COLUMNS

    if isinstance(X_scaled, pd.DataFrame):
        X_mat = X_scaled.values
    else:
        X_mat = np.asarray(X_scaled)

    y_act = np.asarray(y_actual)
    y_pr = np.asarray(y_pred)

    n_features = len(features)
    n_cols = 2
    n_rows = (n_features + 1) // n_cols

    fig, axes = plt.subplots(n_rows, n_cols, figsize=(12, 4 * n_rows), squeeze=False)
    fig.suptitle(
        f"Actual vs Predicted {target_name} by Standardized Feature (Z-Score)",
        fontsize=16,
        fontweight="bold",
        y=0.98,
    )

    for idx, feature_name in enumerate(features):
        row, col = idx // n_cols, idx % n_cols
        ax = axes[row, col]

        x_feat = X_mat[:, idx]

        # Both Actual and Predicted use circle markers ('o') with different colors
        ax.scatter(x_feat, y_act, color="#1f77b4", alpha=0.6, label="Actual", marker="o", s=35)
        ax.scatter(x_feat, y_pr, color="#e74c3c", alpha=0.7, label="Predicted", marker="o", s=35)

        display_name = FEATURE_DISPLAY_NAMES.get(feature_name, feature_name.replace("_", " ").title())
        ax.set_title(f"Actual vs Predicted: {display_name}", fontsize=12, fontweight="bold")
        ax.set_xlabel(f"Standardized {display_name} (Z-score)", fontsize=10)
        ax.set_ylabel(f"{target_name} (%)", fontsize=10)
        ax.grid(True, linestyle="--", alpha=0.5)
        ax.axvline(0, color="gray", linestyle=":", linewidth=1, alpha=0.7)  # Vertical line at Z=0
        ax.legend(loc="best", fontsize=9)

    # Hide unused subplot slots
    for idx in range(n_features, n_rows * n_cols):
        row, col = idx // n_cols, idx % n_cols
        fig.delaxes(axes[row, col])

    plt.tight_layout(rect=[0, 0, 1, 0.95])

    if save_path:
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        fig.savefig(save_path, dpi=300, bbox_inches="tight")
        print(f"[ Visualization ] Saved Actual vs Predicted plot to: {save_path}")

    return fig


if __name__ == "__main__":
    print("[ Visualization ] Loading saved model artifacts from disk...")
    # Load model and scaler trained previously without training a new model
    model, scaler = load_model_artifacts(save_dir="models")

    # Load dataset
    df = prepare_training_data()
    X = df[FEATURE_COLUMNS]
    y_actual = df[TARGET_COLUMN]

    # Transform features using loaded scaler and generate predictions
    X_scaled = scaler.transform(X)
    y_pred = predict_engagement(model, scaler, X)

    # Plot actual vs predicted scatter plot
    save_file = "models/analysis_plots/actual_vs_predicted.png"
    fig = plot_actual_vs_predicted(
        X_scaled=X_scaled,
        y_actual=y_actual,
        y_pred=y_pred,
        features=FEATURE_COLUMNS,
        save_path=save_file,
    )

    print(f"[ Visualization ] Post-training scatter plot successfully created at {save_file}!")
