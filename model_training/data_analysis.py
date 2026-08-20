"""
Data Analysis Module for Raw Video Features & Engagement Metrics.

This module provides Exploratory Data Analysis (EDA) visualizations to help users
evaluate their dataset before feeding it into the multiple linear regression model:
1. Feature Histograms: Distribution of videos across each feature.
2. Pearson Correlation Analysis: Single combined graph of feature & target correlations.
3. LOESS (Locally Estimated Scatterplot Smoothing): Non-linear trend curves of
   Engagement (average_percentage_viewed) vs. each feature.
"""
from typing import Optional, List, Dict, Tuple
import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from model_training.data_preparation import FEATURE_COLUMNS, TARGET_COLUMN


def compute_loess(
    x: np.ndarray,
    y: np.ndarray,
    frac: float = 0.66,
    n_points: int = 100,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Computes Locally Estimated Scatterplot Smoothing (LOESS) using weighted linear regression
    with a tricube weighting kernel.

    Parameters:
        x: 1D array of feature values.
        y: 1D array of target values.
        frac: Smoothing parameter (fraction of points used for local regression, 0 < frac <= 1).
        n_points: Number of evaluation points along the curve.

    Returns:
        Tuple of (x_smooth, y_smooth) arrays.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    
    # Sort data points by x for clean curve rendering
    sorted_indices = np.argsort(x)
    x = x[sorted_indices]
    y = y[sorted_indices]
    
    n = len(x)
    k = max(2, int(np.ceil(frac * n)))
    
    x_eval = np.linspace(x.min(), x.max(), n_points)
    y_eval = np.zeros(n_points)

    for i, x0 in enumerate(x_eval):
        distances = np.abs(x - x0)
        idx = np.argsort(distances)[:k]
        max_dist = distances[idx[-1]]

        if max_dist == 0:
            weights = np.ones(k)
        else:
            norm_dist = distances[idx] / max_dist
            weights = (1.0 - norm_dist**3)**3

        x_k = x[idx]
        y_k = y[idx]

        # Fit weighted linear regression: y = a + b * (x - x0)
        X_mat = np.column_stack([np.ones(k), x_k - x0])
        W_sqrt = np.sqrt(weights)

        try:
            beta, _, _, _ = np.linalg.lstsq(
                X_mat * W_sqrt[:, None],
                y_k * W_sqrt,
                rcond=None,
            )
            y_eval[i] = beta[0]
        except np.linalg.LinAlgError:
            y_eval[i] = np.mean(y_k)

    return x_eval, y_eval


def plot_feature_histograms(
    df: pd.DataFrame,
    features: Optional[List[str]] = None,
    bins: int = 15,
    save_path: Optional[str] = None,
) -> plt.Figure:
    """
    Generates histograms for each feature displaying number of videos on y-axis
    and feature values on x-axis.

    Parameters:
        df: Pandas DataFrame containing feature columns.
        features: List of feature names to plot. Defaults to FEATURE_COLUMNS.
        bins: Number of histogram bins.
        save_path: Optional file path to save figure.

    Returns:
        Matplotlib Figure object.
    """
    if features is None:
        features = [col for col in FEATURE_COLUMNS if col in df.columns]

    n_features = len(features)
    n_cols = 2
    n_rows = (n_features + 1) // n_cols

    fig, axes = plt.subplots(n_rows, n_cols, figsize=(12, 4 * n_rows), squeeze=False)
    fig.suptitle("Feature Distributions (Video Frequency)", fontsize=16, fontweight="bold", y=0.98)

    for idx, feature in enumerate(features):
        row, col = idx // n_cols, idx % n_cols
        ax = axes[row, col]

        data = df[feature].dropna()
        ax.hist(data, bins=bins, color="#3498db", edgecolor="#2980b9", alpha=0.75)
        
        # Mean & Median indicators
        mean_val = data.mean()
        median_val = data.median()
        ax.axvline(mean_val, color="#e74c3c", linestyle="--", linewidth=1.5, label=f"Mean: {mean_val:.1f}")
        ax.axvline(median_val, color="#2ecc71", linestyle=":", linewidth=1.5, label=f"Median: {median_val:.1f}")

        ax.set_title(f"Distribution of {feature.replace('_', ' ').title()}", fontsize=12, fontweight="bold")
        ax.set_xlabel(feature.replace("_", " ").title(), fontsize=10)
        ax.set_ylabel("Number of Videos", fontsize=10)
        ax.grid(True, linestyle="--", alpha=0.5)
        ax.legend(loc="upper right", fontsize=9)

    # Hide unused subplot slots
    for idx in range(n_features, n_rows * n_cols):
        row, col = idx // n_cols, idx % n_cols
        fig.delaxes(axes[row, col])

    plt.tight_layout(rect=[0, 0, 1, 0.95])

    if save_path:
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        fig.savefig(save_path, dpi=300, bbox_inches="tight")
        print(f"[ Analysis ] Saved feature histograms to: {save_path}")

    return fig


def plot_pearson_correlation(
    df: pd.DataFrame,
    features: Optional[List[str]] = None,
    target: str = TARGET_COLUMN,
    save_path: Optional[str] = None,
) -> plt.Figure:
    """
    Computes Pearson Correlation matrix for features and target variable,
    displaying all correlations in a single combined graph heatmap.

    Parameters:
        df: Pandas DataFrame containing features and target.
        features: List of feature column names. Defaults to FEATURE_COLUMNS.
        target: Name of target column. Defaults to TARGET_COLUMN.
        save_path: Optional file path to save figure.

    Returns:
        Matplotlib Figure object.
    """
    if features is None:
        features = [col for col in FEATURE_COLUMNS if col in df.columns]

    columns_to_corr = [col for col in features if col in df.columns]
    if target in df.columns and target not in columns_to_corr:
        columns_to_corr.append(target)

    corr_matrix = df[columns_to_corr].corr(method="pearson")

    fig, ax = plt.subplots(figsize=(8, 6))
    cax = ax.matshow(corr_matrix, cmap="coolwarm", vmin=-1.0, vmax=1.0)
    fig.colorbar(cax, shrink=0.8)

    labels = [c.replace("_", " ").title() for c in columns_to_corr]
    ax.set_xticks(range(len(labels)))
    ax.set_yticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha="left", fontsize=10)
    ax.set_yticklabels(labels, fontsize=10)

    # Annotate correlation values inside heatmap cells
    for i in range(len(columns_to_corr)):
        for j in range(len(columns_to_corr)):
            val = corr_matrix.iloc[i, j]
            color = "white" if abs(val) > 0.5 else "black"
            ax.text(j, i, f"{val:.2f}", ha="center", va="center", color=color, fontweight="bold", fontsize=11)

    ax.set_title("Pearson Correlation Analysis (Features & Target)", fontsize=14, fontweight="bold", pad=40)
    plt.tight_layout()

    if save_path:
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        fig.savefig(save_path, dpi=300, bbox_inches="tight")
        print(f"[ Analysis ] Saved correlation heatmap to: {save_path}")

    return fig


def plot_loess_smoothings(
    df: pd.DataFrame,
    features: Optional[List[str]] = None,
    target: str = TARGET_COLUMN,
    frac: float = 0.66,
    save_path: Optional[str] = None,
) -> plt.Figure:
    """
    Generates LOESS (Locally Estimated Scatterplot Smoothing) curves for each feature
    with average percentage viewed on y-axis and features on x-axis.

    Parameters:
        df: Pandas DataFrame containing features and target.
        features: List of feature names. Defaults to FEATURE_COLUMNS.
        target: Target column name. Defaults to TARGET_COLUMN.
        frac: Smoothing parameter for LOESS.
        save_path: Optional file path to save figure.

    Returns:
        Matplotlib Figure object.
    """
    if features is None:
        features = [col for col in FEATURE_COLUMNS if col in df.columns]

    n_features = len(features)
    n_cols = 2
    n_rows = (n_features + 1) // n_cols

    fig, axes = plt.subplots(n_rows, n_cols, figsize=(12, 4 * n_rows), squeeze=False)
    fig.suptitle(
        f"LOESS Analysis: Engagement ({target.replace('_', ' ').title()}) vs Features",
        fontsize=16,
        fontweight="bold",
        y=0.98,
    )

    for idx, feature in enumerate(features):
        row, col = idx // n_cols, idx % n_cols
        ax = axes[row, col]

        valid_data = df[[feature, target]].dropna()
        x_data = valid_data[feature].values
        y_data = valid_data[target].values

        # Scatter plot of raw video data points
        ax.scatter(x_data, y_data, alpha=0.5, color="#7f8c8d", edgecolors="none", label="Videos")

        # LOESS curve fitting
        if len(x_data) >= 5:
            x_smooth, y_smooth = compute_loess(x_data, y_data, frac=frac)
            ax.plot(x_smooth, y_smooth, color="#e74c3c", linewidth=2.5, label=f"LOESS Trend (frac={frac})")

        ax.set_title(f"{target.replace('_', ' ').title()} vs {feature.replace('_', ' ').title()}", fontsize=12, fontweight="bold")
        ax.set_xlabel(feature.replace("_", " ").title(), fontsize=10)
        ax.set_ylabel(target.replace("_", " ").title() + " (%)", fontsize=10)
        ax.grid(True, linestyle="--", alpha=0.5)
        ax.legend(loc="best", fontsize=9)

    # Hide unused subplot slots
    for idx in range(n_features, n_rows * n_cols):
        row, col = idx // n_cols, idx % n_cols
        fig.delaxes(axes[row, col])

    plt.tight_layout(rect=[0, 0, 1, 0.95])

    if save_path:
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        fig.savefig(save_path, dpi=300, bbox_inches="tight")
        print(f"[ Analysis ] Saved LOESS plots to: {save_path}")

    return fig


def generate_full_analysis_report(
    df: pd.DataFrame,
    save_dir: Optional[str] = "plots",
) -> Dict[str, plt.Figure]:
    """
    Runs all data analysis visualizations (histograms, Pearson correlation, LOESS curves)
    and optionally saves figures to disk.

    Parameters:
        df: Pandas DataFrame containing features and target.
        save_dir: Optional directory to save output plots.

    Returns:
        Dictionary mapping plot names to Matplotlib Figure objects.
    """
    print("[ Analysis ] Generating exploratory data analysis report...")

    hist_path = os.path.join(save_dir, "feature_histograms.png") if save_dir else None
    corr_path = os.path.join(save_dir, "pearson_correlation.png") if save_dir else None
    loess_path = os.path.join(save_dir, "loess_smoothing.png") if save_dir else None

    fig_hist = plot_feature_histograms(df, save_path=hist_path)
    fig_corr = plot_pearson_correlation(df, save_path=corr_path)
    fig_loess = plot_loess_smoothings(df, save_path=loess_path)

    return {
        "histograms": fig_hist,
        "correlation": fig_corr,
        "loess": fig_loess,
    }


if __name__ == "__main__":
    from model_training.mock_data import generate_mock_training_data

    print("[ Analysis Test ] Generating mock data for visualization test...")
    df_test = generate_mock_training_data(num_samples=200, random_state=42)

    plots = generate_full_analysis_report(df_test, save_dir="models/analysis_plots")
    print("[ Analysis Test ] All 3 analysis visualizations created successfully!")
