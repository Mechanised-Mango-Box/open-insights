"""Where a model's training videos sat, said in aggregates.

Lets the Recommend step place one video against the videos a model learned
from - "longer pauses than 82% of them" - and show what those videos typically
got at each value. Saved in the model card (model_card.py), which is public
JSON and travels in shared packages, so nothing here is a row: histograms,
quantiles, and per-bin viewing quartiles only where enough videos share a bin
that no single one can be read off it.

Built from the training split alone - the rows the scaler saw - so a video's
percentile, its training mean and its z-score all describe the same videos.
"""
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

# The Analysis step's histograms use the same count (HISTOGRAM_BINS in
# client/src/app/data-management/analysis/stats.ts), and np.histogram's binning.
DEFAULT_BINS = 15

# Quantiles every 5%: p0 (the minimum) to p100 (the maximum).
QUANTILE_LEVELS = [float(level) for level in range(0, 101, 5)]

# Fewer videos than this in a bin and its viewing quartiles are left out, so a
# sparse bin cannot give away one video's APV.
MIN_VIDEOS_PER_BIN = 5


def _quantiles(values: np.ndarray) -> List[float]:
    return [float(q) for q in np.percentile(values, QUANTILE_LEVELS)]


def _quartile(values: np.ndarray, level: float) -> Optional[float]:
    if len(values) < MIN_VIDEOS_PER_BIN:
        return None
    return float(np.percentile(values, level))


def _histogram(values: np.ndarray, bins: int, target: Optional[np.ndarray]) -> Dict[str, Any]:
    counts, edges = np.histogram(values, bins=bins)
    histogram: Dict[str, Any] = {
        "edges": [float(edge) for edge in edges],
        "counts": [int(count) for count in counts],
    }
    if target is not None:
        # np.histogram's own rule: every bin is half-open except the last,
        # which keeps its right edge.
        index = np.clip(np.searchsorted(edges, values, side="right") - 1, 0, bins - 1)
        per_bin = [target[index == i] for i in range(bins)]
        for key, level in (("target_p25", 25), ("target_median", 50), ("target_p75", 75)):
            histogram[key] = [_quartile(bin_target, level) for bin_target in per_bin]
    return histogram


def summarise_training_data(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    features: List[str],
    bins: int = DEFAULT_BINS,
) -> Dict[str, Any]:
    """Each feature's spread, and the target's, across the training rows."""
    target = y_train.to_numpy(dtype=float)
    return {
        "rows": int(len(X_train)),
        "bins": bins,
        "min_videos_per_bin": MIN_VIDEOS_PER_BIN,
        "quantile_levels": QUANTILE_LEVELS,
        "features": {
            name: {
                "quantiles": _quantiles(X_train[name].to_numpy(dtype=float)),
                "histogram": _histogram(X_train[name].to_numpy(dtype=float), bins, target),
            }
            for name in features
        },
        "target": {
            "quantiles": _quantiles(target),
            "histogram": _histogram(target, bins, None),
        },
    }


def percentile_of(value: float, quantiles: List[float]) -> float:
    """Roughly what percentage of the training rows sit below value, read off
    the 5% quantiles by straight-line interpolation: 0 below the minimum, 100
    above the maximum. Ties make it land in the middle of their run."""
    xs = np.asarray(quantiles, dtype=float)
    levels = QUANTILE_LEVELS
    if value < xs[0]:
        return 0.0
    if value > xs[-1]:
        return 100.0
    first = int(np.searchsorted(xs, value, side="left"))
    past = int(np.searchsorted(xs, value, side="right"))
    if first < past:
        # value equals one or more quantiles: the middle of that run.
        return (levels[first] + levels[past - 1]) / 2
    x0, x1 = xs[first - 1], xs[first]
    return float(levels[first - 1] + (value - x0) / (x1 - x0) * (levels[first] - levels[first - 1]))


def validate_distribution(distribution: Any) -> List[str]:
    """Everything wrong with a card's training_distribution, or []. Only its
    shape: inference reads the summaries of the model's own features and
    ignores any others, and a feature without one just goes unplaced."""
    if not isinstance(distribution, dict):
        return ["training_distribution must be an object."]
    errors = []
    per_feature = distribution.get("features")
    if not isinstance(per_feature, dict):
        return ["training_distribution.features must be an object."]
    for name, summary in per_feature.items():
        if not _valid_summary(summary):
            errors.append(f"training_distribution.features.{name} is malformed.")
    if not _valid_summary(distribution.get("target")):
        errors.append("training_distribution.target is malformed.")
    return errors


def _numbers(value: Any, length: Optional[int] = None) -> bool:
    return (
        isinstance(value, list)
        and (length is None or len(value) == length)
        and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value)
    )


def _valid_summary(summary: Any) -> bool:
    if not isinstance(summary, dict):
        return False
    histogram = summary.get("histogram")
    if not _numbers(summary.get("quantiles"), len(QUANTILE_LEVELS)) or not isinstance(histogram, dict):
        return False
    edges, counts = histogram.get("edges"), histogram.get("counts")
    return _numbers(edges) and _numbers(counts) and len(edges) == len(counts) + 1 >= 2
