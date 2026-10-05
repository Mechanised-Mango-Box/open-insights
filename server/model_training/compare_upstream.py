"""
Comparison Against the Upstream EduVideo Insights Project and Its Paper.

Tolba et al., "An Open Workflow Model for Improving Educational Video Design"
(AAEE 2025) analysed 144 lecture videos with github.com/Mohamed-Tolba/edu-video-insights.
This project has scanned the same 144 videos. This module puts three sets of
results side by side:

    paper     what the paper reports (typed in below, from Figure 5 and Stage 5)
    upstream  upstream's committed dataset (data/sample/edu-video-insights/), re-run here
    project   a client export of the same videos, read as data_preparation.py reads it

Every model runs under three protocols, so each number is set beside one that was
produced the same way:

    paper     z-score on all 144 videos, fit and scored on those same videos (in-sample)
    split     train.py's 80/20 split (random_state=42), scored on the 29 held-out videos
    cv        repeated 5-fold cross-validation, scored on held-out folds

The write-up is data/sample/edu-video-insights/COMPARISON.md.

    python -m model_training.compare_upstream <export folder or .zip>
        [--upstream-dir ../data/sample/edu-video-insights] [--out build/comparison]
"""
import argparse
import os
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import RepeatedKFold, train_test_split

from model_training.data_analysis import FEATURE_DISPLAY_NAMES, compute_loess
from model_training.data_preparation import (
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    _read_manifest,
    _record_to_row,
)
from model_training.evaluation import evaluate_model
from model_training.regression import fit_scaler_and_train_model, predict_engagement

SERVER_DIR = Path(__file__).resolve().parent.parent
DEFAULT_UPSTREAM_DIR = SERVER_DIR.parent / "data" / "sample" / "edu-video-insights"
# Under server/build/, which is gitignored, as model_visualisation.py does.
DEFAULT_OUT_DIR = SERVER_DIR / "build" / "comparison"

# all_train_dataset.csv's column names -> this project's.
UPSTREAM_COLUMNS: Dict[str, str] = {
    "duration_min": "duration",
    "speaking_words_count": "word_count",
    "avg_speaking_speed_wpm": "wpm",
    "scenes_count": "scene_count",
    "avg_scene_change_per_min": "scene_change_rate",
}

# The paper's five features, in the paper's order (Figures 4-7).
PAPER_FEATURES: List[str] = ["duration", "word_count", "wpm", "scene_count", "scene_change_rate"]

# What this project measures that the paper did not.
PROJECT_EXTRA_FEATURES: List[str] = [f for f in FEATURE_COLUMNS if f not in PAPER_FEATURES]


# As printed in the paper: Figure 5 and the Stage 5 text. It reports no intercept.
PAPER_CORRELATIONS: Dict[str, float] = {
    "duration": -0.23,
    "word_count": -0.22,
    "wpm": -0.03,
    "scene_count": -0.01,
    "scene_change_rate": 0.09,
}
PAPER_WEIGHTS: Dict[str, float] = {
    "duration": -21.81,
    "word_count": 20.52,
    "wpm": -3.04,
    "scene_count": -1.02,
    "scene_change_rate": 1.15,
}
PAPER_RMSE = 8.6
PAPER_R2 = 0.0853

# upstream scripts/model_data.py: statsmodels lowess(frac=0.3).
UPSTREAM_LOESS_FRAC = 0.3

EXTRACTION_METHODS: List[Tuple[str, str, str]] = [
    (
        "duration",
        "OpenCV frame count / fps",
        "OpenCV frame count / fps",
    ),
    (
        "word_count",
        "openai-whisper `base`; bracketed tags like [music] removed; whitespace split",
        "faster-whisper `tiny.en` (CTranslate2, int8); segments joined; whitespace split",
    ),
    (
        "wpm",
        "word_count / duration",
        "word_count / duration",
    ),
    (
        "scene_count",
        "PySceneDetect `ContentDetector(threshold=30)`; scenes counted, excluding any "
        "that start in the first 1 s or end in the last 2 s",
        "Frames whose grayscale mean abs-diff from the previous frame exceeds 30",
    ),
    (
        "scene_change_rate",
        "scene_count / duration",
        "scene_count / duration",
    ),
    (
        "text_density",
        "Not measured",
        "RapidOCR (PP-OCRv6 small) on one frame every 5 s; words from lines read with "
        "confidence >= 0.8, averaged over the video",
    ),
    (
        "speech_ratio",
        "Not measured",
        "Silero VAD (ending speech at a 250 ms silence, padded 30 ms) on the 16 kHz audio; "
        "seconds of speech / duration",
    ),
    (
        "mean_pause_secs",
        "Not measured",
        "The same VAD pass; mean gap between consecutive stretches of speech",
    ),
    (
        TARGET_COLUMN,
        "YouTube Analytics average percentage viewed, copied by hand",
        "average view duration / duration x 100, from the Studio content report "
        "recreated by gen_youtube_exports.py",
    ),
]

# Colour follows the dataset in every figure.
COLOURS = {"paper": "#1baf7a", "upstream": "#2a78d6", "project": "#eb6834"}
INK_MUTED = "#52514e"
GRID = "#e4e3df"


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def load_upstream(upstream_dir: Path) -> pd.DataFrame:
    """upstream's all_train_dataset.csv in this project's column names, indexed by video id."""
    df = pd.read_csv(Path(upstream_dir) / "all_train_dataset.csv")
    df = df.rename(columns=UPSTREAM_COLUMNS).set_index("video_id")
    if not df.index.is_unique:
        raise ValueError("all_train_dataset.csv lists a video more than once.")
    return df[["dataset_tag"] + PAPER_FEATURES + [TARGET_COLUMN]]


def load_project(export_path: Path) -> Tuple[pd.DataFrame, Counter]:
    """
    An export's training rows, as load_export_dataset() builds them, plus each video's
    YouTube id (the join key) and raw scene count (the paper's fourth feature, which
    this project's models use only as a rate). Also returns why any record was skipped.
    """
    manifest = _read_manifest(Path(export_path))
    rows: List[Dict[str, Any]] = []
    skipped: Counter = Counter()
    for record in manifest.get("records") or []:
        row, reason = _record_to_row(record)
        if reason == "speech never paused, so no mean pause":
            # Kept, with the one feature it lacks as NaN: every comparison but the
            # current model's needs all 144 videos to be the paper's 144, and that
            # model's rows drop it themselves (see model_rows()).
            patched = {**record, "audio_stats": {**record["audio_stats"], "mean_pause_secs": np.nan}}
            row, reason = _record_to_row(patched)
        if row is None:
            skipped[reason] += 1
            continue
        row["video_id"] = record["youtube_content"].get("content")
        row["scene_count"] = record["scene_stats"]["scenes"]
        rows.append(row)

    df = pd.DataFrame(rows).set_index("video_id")
    if not df.index.is_unique:
        duplicates = sorted(set(df.index[df.index.duplicated()]))
        raise ValueError(f"The export has more than one record for: {', '.join(duplicates)}")
    return df, skipped


def model_rows(project: pd.DataFrame) -> pd.DataFrame:
    """The project rows the current model can use: those with every feature. A
    video with fewer than two stretches of speech has no mean pause, and train.py
    skips it."""
    return project.dropna(subset=FEATURE_COLUMNS)


def align(upstream: pd.DataFrame, project: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Both datasets over the same videos, both in the export's order - so a split by
    position picks the same videos from each, and the same ones train.py picks.

    Raises ValueError naming every video only one side has: a comparison over a
    silently narrowed set would not be a comparison with the paper.
    """
    only_upstream = sorted(upstream.index.difference(project.index))
    only_project = sorted(project.index.difference(upstream.index))
    if only_upstream or only_project:
        problems = []
        if only_upstream:
            problems.append(f"missing from the export: {', '.join(only_upstream)}")
        if only_project:
            problems.append(f"not in upstream's dataset: {', '.join(only_project)}")
        raise ValueError("The datasets do not cover the same videos - " + "; ".join(problems))
    return upstream.loc[project.index], project


def _clock_to_secs(clock: Any) -> float:
    # A report row with no views has no average view duration.
    if not isinstance(clock, str):
        return np.nan
    hours, minutes, seconds = (int(part) for part in clock.split(":"))
    return hours * 3600 + minutes * 60 + seconds


def load_studio_reports(raw_dir: Path) -> pd.DataFrame:
    """upstream_raw/*_2.csv - the real Studio content reports - one row per video."""
    frames = []
    for path in sorted(Path(raw_dir).glob("*_2.csv")):
        report = pd.read_csv(path)
        report = report[report["Content"] != "Total"]
        frames.append(pd.DataFrame({
            "studio_duration_secs": report["Duration"].astype(float).to_numpy(),
            "studio_avd_secs": report["Average view duration"].map(_clock_to_secs).to_numpy(),
            "studio_apv": report["Average percentage viewed (%)"].astype(float).to_numpy(),
        }, index=pd.Index(report["Content"].to_numpy(), name="video_id")))
    return pd.concat(frames)


def load_retention_means(raw_dir: Path) -> pd.Series:
    """The mean of each video's 100-point retention curve in upstream_raw/*_1.csv, as a %."""
    means = {}
    for path in sorted(Path(raw_dir).glob("*_1.csv")):
        for video_id, curve in pd.read_csv(path)[["Video", "Retention"]].itertuples(index=False):
            points = np.array([float(p) for p in curve.strip("[]").split(";")])
            means[video_id] = points.mean() * 100
    return pd.Series(means, name="retention_mean")


# ---------------------------------------------------------------------------
# Data agreement
# ---------------------------------------------------------------------------

def feature_agreement(upstream: pd.DataFrame, project: pd.DataFrame) -> pd.DataFrame:
    """Per-video agreement between the two datasets' values. Differences are project - upstream."""
    rows = []
    for column in PAPER_FEATURES + [TARGET_COLUMN]:
        a, b = upstream[column], project[column]
        diff = b - a
        rows.append({
            "feature": column,
            "r": a.corr(b),
            "upstream_mean": a.mean(),
            "project_mean": b.mean(),
            "mean_diff": diff.mean(),
            "median_diff": diff.median(),
            "mae": diff.abs().mean(),
            "max_abs_diff": diff.abs().max(),
        })
    return pd.DataFrame(rows).set_index("feature")


def target_provenance(
    upstream: pd.DataFrame,
    project: pd.DataFrame,
    studio: pd.DataFrame,
    retention_means: pd.Series,
) -> pd.DataFrame:
    """Each route to average percentage viewed, compared per video. Differences are b - a."""
    studio = studio.reindex(upstream.index)
    studio_avd_pct = studio["studio_avd_secs"] / studio["studio_duration_secs"] * 100
    apv = upstream[TARGET_COLUMN]
    pairs = [
        ("upstream APV (all_metrics)", "Studio APV", apv, studio["studio_apv"]),
        ("upstream APV (all_metrics)", "Studio AVD / Studio duration", apv, studio_avd_pct),
        ("upstream APV (all_metrics)", "project target", apv, project[TARGET_COLUMN]),
        ("Studio AVD / Studio duration", "project target", studio_avd_pct, project[TARGET_COLUMN]),
        ("upstream APV (all_metrics)", "retention-curve mean", apv, retention_means.reindex(upstream.index)),
        ("upstream duration (min)", "Studio duration (min)", upstream["duration"], studio["studio_duration_secs"] / 60),
    ]
    rows = []
    for a_name, b_name, a, b in pairs:
        diff = (b - a).dropna()
        rows.append({
            "a": a_name,
            "b": b_name,
            "videos": len(diff),
            "exact_to_2dp": int((diff.abs() < 0.005).sum()),
            "r": a.corr(b),
            "mean_diff": diff.mean(),
            "mae": diff.abs().mean(),
            "max_abs_diff": diff.abs().max(),
        })
    return pd.DataFrame(rows)


def correlation_table(upstream: pd.DataFrame, project: pd.DataFrame) -> pd.DataFrame:
    """Pearson r of each feature with the target: paper, upstream re-run, project."""
    features = PAPER_FEATURES + PROJECT_EXTRA_FEATURES
    return pd.DataFrame({
        "paper": [PAPER_CORRELATIONS.get(f, np.nan) for f in features],
        "upstream": [upstream[f].corr(upstream[TARGET_COLUMN]) if f in upstream else np.nan for f in features],
        "project": [project[f].corr(project[TARGET_COLUMN]) for f in features],
    }, index=pd.Index(features, name="feature"))


def distribution_table(upstream: pd.DataFrame, project: pd.DataFrame) -> pd.DataFrame:
    """Median, interquartile range and extremes of each feature, per dataset."""
    rows = []
    for column in PAPER_FEATURES + PROJECT_EXTRA_FEATURES + [TARGET_COLUMN]:
        for name, df in (("upstream", upstream), ("project", project)):
            if column not in df:
                continue
            values = df[column]
            rows.append({
                "feature": column,
                "dataset": name,
                "min": values.min(),
                "q25": values.quantile(0.25),
                "median": values.median(),
                "q75": values.quantile(0.75),
                "max": values.max(),
            })
    return pd.DataFrame(rows)


def variance_inflation(df: pd.DataFrame, features: List[str]) -> Dict[str, float]:
    """Each feature's VIF: 1 / (1 - R^2) of that feature regressed on the others."""
    X = df[features].to_numpy(dtype=float)
    vifs = {}
    for i, feature in enumerate(features):
        others = np.column_stack([np.ones(len(X)), np.delete(X, i, axis=1)])
        coef, *_ = np.linalg.lstsq(others, X[:, i], rcond=None)
        residual = X[:, i] - others @ coef
        vifs[feature] = float(X[:, i].var() / residual.var())
    return vifs


# ---------------------------------------------------------------------------
# Models, under each protocol
# ---------------------------------------------------------------------------

def upstream_gradient_descent(
    X_norm: np.ndarray,
    y: np.ndarray,
    alpha: float = 0.9,
    num_iters: int = 2000,
) -> Tuple[np.ndarray, float]:
    """
    upstream's MultipleLinearRegression.gradient_descent (core/regression_core.py),
    vectorised, with the settings scripts/model_data.py fits the paper's model with.

    It stops short of the least-squares solution on this data - duration and word
    count are almost collinear, which makes the descent slow - so its weights are
    the paper's, not closed-form OLS's. regression_core.py's own __main__ uses
    alpha=0.92, which diverges here.
    """
    m, n = X_norm.shape
    w = np.zeros(n)
    b = 0.0
    for _ in range(num_iters):
        err = X_norm @ w + b - y
        w, b = w - alpha * (X_norm.T @ err) / m, b - alpha * err.mean()
    return w, b


def paper_protocol(df: pd.DataFrame, features: List[str], solver: str = "ols") -> Dict[str, Any]:
    """
    The paper's Stage 5: z-score every feature over all videos (population standard
    deviation, as upstream's zscore_normalize_features), fit a linear regression, and
    score it on the same videos it was fitted to.

    solver: "gd" for upstream's gradient descent, "ols" for the closed-form fit.
    """
    X = df[features].to_numpy(dtype=float)
    y = df[TARGET_COLUMN].to_numpy(dtype=float)
    X_norm = (X - X.mean(axis=0)) / X.std(axis=0)

    if solver == "gd":
        w, b = upstream_gradient_descent(X_norm, y)
    elif solver == "ols":
        model = LinearRegression().fit(X_norm, y)
        w, b = model.coef_, float(model.intercept_)
    else:
        raise ValueError(f"Unknown solver: {solver}")

    metrics = evaluate_model(y, X_norm @ w + b)
    return {
        "weights": {f: float(v) for f, v in zip(features, w)},
        "intercept": float(b),
        "rmse": float(metrics["rmse"]),
        "r2": float(metrics["r2"]),
    }


def _fit_and_score(X_train, X_test, y_train, y_test, random_state: int) -> Dict[str, Dict[str, float]]:
    """The two models train.py fits, and a predict-the-training-mean baseline, scored on X_test."""
    model, scaler = fit_scaler_and_train_model(X_train, y_train)
    forest = RandomForestRegressor(random_state=random_state, n_jobs=-1).fit(X_train, y_train)
    return {
        "linear": evaluate_model(y_test, predict_engagement(model, scaler, X_test)),
        "forest": evaluate_model(y_test, forest.predict(X_test)),
        "mean": evaluate_model(y_test, np.full(len(y_test), y_train.mean())),
    }


def split_protocol(
    df: pd.DataFrame,
    features: List[str],
    test_size: float = 0.2,
    random_state: int = 42,
) -> Dict[str, Any]:
    """train.py's protocol: one 80/20 split, scaler fitted on the training part."""
    X_train, X_test, y_train, y_test = train_test_split(
        df[features], df[TARGET_COLUMN], test_size=test_size, random_state=random_state
    )
    scores = _fit_and_score(X_train, X_test, y_train, y_test, random_state)
    return {name: {k: float(v) for k, v in s.items()} for name, s in scores.items()} | {
        "test_videos": list(X_test.index),
    }


def cv_protocol(
    df: pd.DataFrame,
    features: List[str],
    n_splits: int = 5,
    n_repeats: int = 10,
    random_state: int = 42,
) -> Dict[str, Dict[str, float]]:
    """Repeated k-fold cross-validation: mean and sample SD of each score over every fold."""
    X, y = df[features], df[TARGET_COLUMN]
    folds: Dict[str, List[Dict[str, float]]] = {"linear": [], "forest": [], "mean": []}
    splitter = RepeatedKFold(n_splits=n_splits, n_repeats=n_repeats, random_state=random_state)
    for train_idx, test_idx in splitter.split(X):
        scores = _fit_and_score(
            X.iloc[train_idx], X.iloc[test_idx], y.iloc[train_idx], y.iloc[test_idx], random_state
        )
        for name, s in scores.items():
            folds[name].append(s)

    summary = {}
    for name, fold_scores in folds.items():
        rmse = np.array([s["rmse"] for s in fold_scores])
        r2 = np.array([s["r2"] for s in fold_scores])
        summary[name] = {
            "rmse_mean": float(rmse.mean()),
            "rmse_sd": float(rmse.std(ddof=1)),
            "r2_mean": float(r2.mean()),
            "r2_sd": float(r2.std(ddof=1)),
        }
    return summary


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------

def _style(ax: plt.Axes) -> None:
    ax.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(INK_MUTED)
    ax.tick_params(colors=INK_MUTED, labelsize=9)


def _label(column: str) -> str:
    if column == TARGET_COLUMN:
        return "Average percentage viewed (%)"
    return FEATURE_DISPLAY_NAMES.get(column, column)


def _save(fig: plt.Figure, out_dir: Path, name: str) -> None:
    path = out_dir / name
    fig.savefig(path, dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"[ Compare ] Saved {path}")


def plot_feature_agreement(upstream: pd.DataFrame, project: pd.DataFrame, out_dir: Path) -> None:
    """Upstream's value against this project's for every video, one panel per feature."""
    columns = PAPER_FEATURES + [TARGET_COLUMN]
    fig, axes = plt.subplots(2, 3, figsize=(13, 8))
    for ax, column in zip(axes.flat, columns):
        a, b = upstream[column], project[column]
        lo, hi = min(a.min(), b.min()), max(a.max(), b.max())
        ax.plot([lo, hi], [lo, hi], color=INK_MUTED, linewidth=1, linestyle="--", label="Identical")
        ax.scatter(a, b, s=18, color=COLOURS["project"], alpha=0.75, edgecolors="white", linewidths=0.5)
        ax.set_title(f"{_label(column)}\nr = {a.corr(b):.3f}, mean |diff| = {(b - a).abs().mean():.2f}",
                     fontsize=10)
        ax.set_xlabel("Upstream", fontsize=9)
        ax.set_ylabel("This project", fontsize=9)
        _style(ax)
    axes.flat[0].legend(fontsize=8, frameon=False, loc="upper left")
    fig.suptitle("The same 144 videos, measured by each pipeline", fontsize=13)
    fig.tight_layout()
    _save(fig, out_dir, "feature_agreement.png")


def plot_distributions(upstream: pd.DataFrame, project: pd.DataFrame, out_dir: Path) -> None:
    """The paper's Figure 4 (15-bin histograms), with both datasets on shared bins."""
    columns = PAPER_FEATURES + [TARGET_COLUMN]
    fig, axes = plt.subplots(3, 2, figsize=(11, 9))
    for ax, column in zip(axes.flat, columns):
        a, b = upstream[column], project[column]
        bins = np.histogram_bin_edges(pd.concat([a, b]), bins=15)
        ax.hist(a, bins=bins, histtype="step", linewidth=2, color=COLOURS["upstream"], label="Upstream")
        ax.hist(b, bins=bins, histtype="step", linewidth=2, color=COLOURS["project"], label="This project")
        ax.set_xlabel(_label(column), fontsize=9)
        ax.set_ylabel("Number of videos", fontsize=9)
        _style(ax)
    axes.flat[0].legend(fontsize=8, frameon=False)
    fig.suptitle("Distributions (paper Figure 4)", fontsize=13)
    fig.tight_layout()
    _save(fig, out_dir, "distributions.png")


def plot_correlations(correlations: pd.DataFrame, out_dir: Path) -> None:
    """The paper's Figure 5 with upstream's re-run and this project's beside it."""
    series = ["paper", "upstream", "project"]
    names = {"paper": "Paper (Fig. 5)", "upstream": "Upstream data", "project": "This project"}
    y = np.arange(len(correlations))
    height = 0.26
    fig, ax = plt.subplots(figsize=(8, 5))
    for i, name in enumerate(series):
        values = correlations[name]
        present = values.notna()
        ax.barh(y[present] + (i - 1) * height, values[present], height=height * 0.9,
                color=COLOURS[name], label=names[name])
    ax.set_yticks(y)
    ax.set_yticklabels([_label(f) for f in correlations.index], fontsize=9)
    ax.invert_yaxis()
    ax.axvline(0, color=INK_MUTED, linewidth=0.8)
    ax.set_xlabel("Pearson r with average percentage viewed", fontsize=9)
    _style(ax)
    ax.legend(fontsize=8, frameon=False, loc="upper right")
    ax.set_title("Correlation with engagement (paper Figure 5)", fontsize=12)
    fig.tight_layout()
    _save(fig, out_dir, "correlations.png")


def plot_loess(upstream: pd.DataFrame, project: pd.DataFrame, out_dir: Path) -> None:
    """The paper's Figure 6: LOESS of engagement against each feature, for both datasets."""
    fig, axes = plt.subplots(3, 2, figsize=(11, 10))
    for ax, column in zip(axes.flat, PAPER_FEATURES):
        for name, df, label in (("upstream", upstream, "Upstream"), ("project", project, "This project")):
            x, y = df[column].to_numpy(), df[TARGET_COLUMN].to_numpy()
            ax.scatter(x, y, s=10, color=COLOURS[name], alpha=0.25, edgecolors="none")
            x_smooth, y_smooth = compute_loess(x, y, frac=UPSTREAM_LOESS_FRAC)
            ax.plot(x_smooth, y_smooth, color=COLOURS[name], linewidth=2, label=label)
        ax.set_xlabel(_label(column), fontsize=9)
        ax.set_ylabel("Average viewed (%)", fontsize=9)
        _style(ax)
    axes.flat[0].legend(fontsize=8, frameon=False, loc="lower left")
    fig.delaxes(axes.flat[-1])
    fig.suptitle(f"LOESS trends, frac = {UPSTREAM_LOESS_FRAC} (paper Figure 6)", fontsize=13)
    fig.tight_layout()
    _save(fig, out_dir, "loess.png")


def plot_paper_weights(paper_rows: Dict[str, Dict[str, Any]], out_dir: Path) -> None:
    """The paper's standardised weights beside the same fit on this project's features."""
    series = [
        ("paper", "Paper (reproduced exactly by upstream's data)", PAPER_WEIGHTS),
        ("project", "This project, same five features and protocol", paper_rows["project_5"]["weights"]),
    ]
    y = np.arange(len(PAPER_FEATURES))
    height = 0.38
    fig, ax = plt.subplots(figsize=(8, 4.2))
    for i, (name, label, weights) in enumerate(series):
        ax.barh(y + (i - 0.5) * height, [weights[f] for f in PAPER_FEATURES], height=height * 0.9,
                color=COLOURS[name], label=label)
    ax.set_yticks(y)
    ax.set_yticklabels([_label(f) for f in PAPER_FEATURES], fontsize=9)
    ax.invert_yaxis()
    ax.axvline(0, color=INK_MUTED, linewidth=0.8)
    ax.set_xlabel("Standardised weight (percentage points per SD)", fontsize=9)
    _style(ax)
    # Below the axis: every quadrant of the plot has a bar in it.
    ax.legend(fontsize=8, frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.16), ncol=2)
    ax.set_title("Linear regression weights, paper protocol (paper Stage 5)", fontsize=12)
    fig.tight_layout()
    _save(fig, out_dir, "paper_protocol_weights.png")


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def _fmt(value: Any, digits: int = 3) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "—"
    if isinstance(value, (int, np.integer)):
        return str(value)
    if isinstance(value, (float, np.floating)):
        # A tiny negative (the mean predictor's R² is a hair below 0) prints as 0, not -0.
        if abs(value) < 0.5 * 10 ** -digits:
            value = 0.0
        return f"{value:.{digits}f}"
    return str(value)


def _table(header: List[str], rows: List[List[Any]], digits: int = 3) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    for row in rows:
        lines.append("| " + " | ".join(_fmt(cell, digits) for cell in row) + " |")
    return "\n".join(lines)


def build_report(results: Dict[str, Any]) -> str:
    """Every table as Markdown."""
    agreement: pd.DataFrame = results["agreement"]
    provenance: pd.DataFrame = results["provenance"]
    correlations: pd.DataFrame = results["correlations"]
    paper_rows = results["paper_protocol"]
    split_rows = results["split_protocol"]
    cv_rows = results["cv_protocol"]
    all_features = PAPER_FEATURES + PROJECT_EXTRA_FEATURES
    sections = []

    sections.append("## Extraction methods\n\n" + _table(
        ["Feature", "Upstream", "This project"], [list(m) for m in EXTRACTION_METHODS]
    ))

    sections.append("## Feature agreement (project - upstream, per video)\n\n" + _table(
        ["Feature", "r", "Upstream mean", "Project mean", "Mean diff", "Median diff", "Mean |diff|", "Max |diff|"],
        [[f, *agreement.loc[f].tolist()] for f in agreement.index],
    ))

    sections.append("## Target provenance (b - a, per video)\n\n" + _table(
        ["a", "b", "Videos", "Equal to 2 dp", "r", "Mean diff", "Mean |diff|", "Max |diff|"],
        provenance.values.tolist(),
    ))

    sections.append("## Pearson correlation with average percentage viewed\n\n" + _table(
        ["Feature", "Paper (Fig. 5)", "Upstream data", "This project"],
        [[f, *correlations.loc[f].tolist()] for f in correlations.index],
    ))

    distributions: pd.DataFrame = results["distributions"]
    sections.append("## Distributions\n\n" + _table(
        ["Feature", "Dataset", "Min", "Q1", "Median", "Q3", "Max"],
        distributions.values.tolist(), digits=2,
    ))

    vif_rows = []
    for name, vifs in results["vif"].items():
        vif_rows.append([name, *[vifs.get(f) for f in all_features]])
    sections.append(
        "## Collinearity\n\n"
        f"corr(duration, word_count): upstream {results['duration_word_corr']['upstream']:.3f}, "
        f"project {results['duration_word_corr']['project']:.3f}.\n\n"
        "Variance inflation factors (above ~10 means a weight cannot be read on its own):\n\n"
        + _table(["Feature set", *all_features], vif_rows, digits=1)
    )

    paper_table = [["Paper (reported)", *[PAPER_WEIGHTS.get(f) for f in all_features], None, PAPER_RMSE, PAPER_R2]]
    for key, label in (
        ("upstream_gd", "Upstream data, upstream's gradient descent"),
        ("upstream_ols", "Upstream data, closed-form OLS"),
        ("project_5", "Project data, paper's 5 features"),
        ("project_model", f"Project data, the model's {len(FEATURE_COLUMNS)} features"),
    ):
        row = paper_rows[key]
        paper_table.append([
            label, *[row["weights"].get(f) for f in all_features], row["intercept"], row["rmse"], row["r2"],
        ])
    sections.append(
        "## Paper protocol: in-sample, z-score over all videos\n\n"
        + _table(["Run", *all_features, "Intercept", "RMSE", "R²"], paper_table, digits=4)
    )

    split_table = []
    for key, label in results["runs"].items():
        s = split_rows[key]
        split_table.append([
            label,
            s["linear"]["rmse"], s["linear"]["r2"],
            s["forest"]["rmse"], s["forest"]["r2"],
            s["mean"]["rmse"], s["mean"]["r2"],
        ])
    sections.append(
        f"## Project protocol: train.py's 80/20 split, same {len(split_rows['project_5']['test_videos'])} "
        "held-out videos for every row but the model's, which splits its own "
        f"{len(split_rows['project_model']['test_videos'])} from the videos it can use\n\n"
        + _table(
            ["Run", "Linear RMSE", "Linear R²", "Forest RMSE", "Forest R²", "Mean-predictor RMSE", "Mean-predictor R²"],
            split_table, digits=4,
        )
    )

    cv_table = []
    for key, label in results["runs"].items():
        c = cv_rows[key]
        cv_table.append([label] + [
            f"{c[m]['rmse_mean']:.2f} ± {c[m]['rmse_sd']:.2f}" for m in ("linear", "forest", "mean")
        ] + [
            f"{c[m]['r2_mean']:+.3f} ± {c[m]['r2_sd']:.3f}" for m in ("linear", "forest", "mean")
        ])
    sections.append(
        "## Repeated 5-fold cross-validation (10 repeats, 50 folds; mean ± SD over folds)\n\n"
        + _table(
            ["Run", "Linear RMSE", "Forest RMSE", "Mean-predictor RMSE",
             "Linear R²", "Forest R²", "Mean-predictor R²"],
            cv_table,
        )
    )

    return "# Upstream comparison\n\n" + "\n\n".join(sections) + "\n"


def run_comparison(
    export_path: Path,
    upstream_dir: Path = DEFAULT_UPSTREAM_DIR,
    out_dir: Optional[Path] = DEFAULT_OUT_DIR,
) -> Dict[str, Any]:
    """Runs every comparison. Writes the report, tables and figures into out_dir when given."""
    upstream_dir = Path(upstream_dir)
    upstream = load_upstream(upstream_dir)
    project, skipped = load_project(Path(export_path))
    print(f"[ Compare ] upstream: {len(upstream)} videos; export: {len(project)} usable records.")
    for reason, count in skipped.most_common():
        print(f"  export skipped {count}: {reason}")
    upstream, project = align(upstream, project)

    raw_dir = upstream_dir / "upstream_raw"
    studio = load_studio_reports(raw_dir)
    retention_means = load_retention_means(raw_dir)

    runs = {
        "upstream_5": "Upstream data, paper's 5 features",
        "project_5": "Project data, paper's 5 features",
        "project_model": f"Project data, the model's {len(FEATURE_COLUMNS)} features",
    }
    model_df = model_rows(project)
    if len(model_df) < len(project):
        dropped = ", ".join(project.index.difference(model_df.index))
        print(f"  the model's rows leave out {len(project) - len(model_df)} with no pause: {dropped}")
    datasets = {
        "upstream_5": (upstream, PAPER_FEATURES),
        "project_5": (project, PAPER_FEATURES),
        "project_model": (model_df, FEATURE_COLUMNS),
    }

    print("[ Compare ] Fitting models (the cross-validation takes a minute)...")
    results: Dict[str, Any] = {
        "runs": runs,
        "agreement": feature_agreement(upstream, project),
        "provenance": target_provenance(upstream, project, studio, retention_means),
        "correlations": correlation_table(upstream, project),
        "distributions": distribution_table(upstream, project),
        "duration_word_corr": {
            "upstream": upstream["duration"].corr(upstream["word_count"]),
            "project": project["duration"].corr(project["word_count"]),
        },
        "vif": {
            runs[key]: variance_inflation(df, features) for key, (df, features) in datasets.items()
        },
        "paper_protocol": {
            "upstream_gd": paper_protocol(upstream, PAPER_FEATURES, solver="gd"),
            "upstream_ols": paper_protocol(upstream, PAPER_FEATURES, solver="ols"),
            "project_5": paper_protocol(project, PAPER_FEATURES, solver="ols"),
            "project_model": paper_protocol(model_df, FEATURE_COLUMNS, solver="ols"),
        },
        "split_protocol": {key: split_protocol(df, features) for key, (df, features) in datasets.items()},
        "cv_protocol": {key: cv_protocol(df, features) for key, (df, features) in datasets.items()},
    }
    results["report"] = build_report(results)

    if out_dir is not None:
        out_dir = Path(out_dir)
        os.makedirs(out_dir, exist_ok=True)
        (out_dir / "report.md").write_text(results["report"], encoding="utf-8")
        results["agreement"].to_csv(out_dir / "feature_agreement.csv")
        results["provenance"].to_csv(out_dir / "target_provenance.csv", index=False)
        results["correlations"].to_csv(out_dir / "correlations.csv")
        results["distributions"].to_csv(out_dir / "distributions.csv", index=False)
        upstream.join(project, lsuffix="_upstream", rsuffix="_project").to_csv(out_dir / "joined.csv")
        print(f"[ Compare ] Saved tables and report.md to {out_dir}")

        plot_feature_agreement(upstream, project, out_dir)
        plot_distributions(upstream, project, out_dir)
        plot_correlations(results["correlations"], out_dir)
        plot_loess(upstream, project, out_dir)
        plot_paper_weights(results["paper_protocol"], out_dir)

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        prog="python -m model_training.compare_upstream",
        description="Compare an export against upstream EduVideo Insights and its AAEE 2025 paper.",
    )
    parser.add_argument("export", type=Path, help="export folder or .zip of the same 144 videos")
    parser.add_argument("--upstream-dir", type=Path, default=DEFAULT_UPSTREAM_DIR,
                        help=f"upstream's dataset (default: {DEFAULT_UPSTREAM_DIR})")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR,
                        help=f"where the report, tables and figures go (default: {DEFAULT_OUT_DIR})")
    args = parser.parse_args()

    try:
        comparison = run_comparison(args.export, args.upstream_dir, args.out)
    except ValueError as err:
        parser.exit(1, f"error: {err}\n")
    print()
    print(comparison["report"])
