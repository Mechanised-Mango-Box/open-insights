import numpy as np
import pandas as pd

# Ported from model_training/data_analysis.py's compute_loess. Pure numpy — no
# matplotlib, since this feeds a JSON API rather than rendering a figure.


def compute_loess(
    x: np.ndarray,
    y: np.ndarray,
    frac: float = 0.66,
    n_points: int = 100,
) -> tuple[np.ndarray, np.ndarray]:
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

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
            weights = (1.0 - norm_dist**3) ** 3

        x_k = x[idx]
        y_k = y[idx]

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


def compute_histogram(values: np.ndarray, bins: int = 15) -> tuple[list[float], list[int]]:
    counts, bin_edges = np.histogram(values, bins=bins)
    return bin_edges.tolist(), counts.tolist()


def compute_correlations(df: pd.DataFrame, features: list[str], target: str) -> dict[str, float]:
    correlations: dict[str, float] = {}
    for feature in features:
        corr_val = df[feature].corr(df[target], method="pearson")
        correlations[feature] = 0.0 if pd.isna(corr_val) else float(corr_val)
    return correlations
