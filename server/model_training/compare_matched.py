"""Compare original and expanded features on matching videos and APV labels.

Run from server/: python -m model_training.compare_matched EXPORT.zip
Writes evaluation artifacts only; never replaces app models.
"""

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import sklearn
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import RepeatedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from model_training.compare_upstream import (
    DEFAULT_UPSTREAM_DIR,
    PAPER_FEATURES,
    load_project,
    load_upstream,
    model_rows,
)
from model_training.data_preparation import FEATURE_COLUMNS, TARGET_COLUMN


def main():
    """Load matching videos, compare models on the same folds, and save results."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export", type=Path)
    parser.add_argument("--out", type=Path, default=Path("build/matched_comparison"))
    args = parser.parse_args()
    upstream = load_upstream(DEFAULT_UPSTREAM_DIR)
    project, skipped = load_project(args.export)
    usable = model_rows(project)
    if set(project.index) != set(upstream.index):
        raise ValueError("Export and original dataset must contain the same video IDs")
    ids = sorted(usable.index)
    project, upstream = project.loc[ids], upstream.loc[ids]
    # The same original YouTube APV label is used in every experiment.
    y = upstream[TARGET_COLUMN]
    runs = [
        ("Mean baseline", upstream, PAPER_FEATURES, "mean"),
        ("Original five / Linear", upstream, PAPER_FEATURES, "linear"),
        ("Original five / Forest", upstream, PAPER_FEATURES, "forest"),
        ("Rescanned five / Linear", project, PAPER_FEATURES, "linear"),
        ("Rescanned five / Forest", project, PAPER_FEATURES, "forest"),
        ("Expanded eight / Linear", project, FEATURE_COLUMNS, "linear"),
        ("Expanded eight / Forest", project, FEATURE_COLUMNS, "forest"),
    ]
    folds = list(RepeatedKFold(n_splits=5, n_repeats=10, random_state=42).split(ids))
    metrics, predictions, partitions = [], [], []
    for fold, (train, test) in enumerate(folds):
        for idx in test:
            partitions.append(
                {"repeat": fold // 5 + 1, "fold": fold % 5 + 1, "video_id": ids[idx]}
            )
    for name, frame, features, kind in runs:
        X = frame[features]
        for fold, (train, test) in enumerate(folds):
            if kind == "mean":
                model = DummyRegressor(strategy="mean")
            elif kind == "linear":
                model = make_pipeline(StandardScaler(), LinearRegression())
            else:
                model = RandomForestRegressor(random_state=42, n_jobs=1)
            model.fit(X.iloc[train], y.iloc[train])
            pred = model.predict(X.iloc[test])
            actual = y.iloc[test]
            metrics.append(
                {
                    "model": name,
                    "repeat": fold // 5 + 1,
                    "fold": fold % 5 + 1,
                    "mae": mean_absolute_error(actual, pred),
                    "rmse": np.sqrt(mean_squared_error(actual, pred)),
                    "r2": r2_score(actual, pred),
                }
            )
            if fold < 5:
                for idx, value in zip(test, pred):
                    predictions.append(
                        {
                            "model": name,
                            "video_id": ids[idx],
                            "fold": fold + 1,
                            "actual_apv": y.iloc[idx],
                            "predicted_apv": value,
                        }
                    )
    args.out.mkdir(parents=True, exist_ok=True)
    scores = pd.DataFrame(metrics)
    summary = scores.groupby("model", sort=False)[["mae", "rmse", "r2"]].agg(
        ["mean", "std"]
    )
    summary.columns = ["_".join(c) for c in summary.columns]
    summary.to_csv(args.out / "summary.csv")
    plot_metric_comparison(summary, args.out)
    scores.to_csv(args.out / "fold_metrics.csv", index=False)
    pd.DataFrame(partitions).to_csv(args.out / "test_fold_assignments.csv", index=False)
    oof = pd.DataFrame(predictions)
    oof.to_csv(args.out / "held_out_predictions.csv", index=False)
    upstream.to_csv(args.out / "original_matched.csv")
    project.to_csv(args.out / "expanded_matched.csv")
    metadata = {
        "export": str(args.export),
        "rows": len(ids),
        "excluded_video_ids": sorted(
            set(load_upstream(DEFAULT_UPSTREAM_DIR).index) - set(ids)
        ),
        "skipped_records": dict(skipped),
        "folds": 5,
        "repeats": 10,
        "random_state": 42,
        "target": "Original dataset APV, identical across runs",
        "sklearn_version": sklearn.__version__,
        "pandas_version": pd.__version__,
        "numpy_version": np.__version__,
    }
    (args.out / "method.json").write_text(json.dumps(metadata, indent=2))
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.5), sharex=True, sharey=True)
    for ax, name in zip(axes, ["Original five / Linear", "Expanded eight / Forest"]):
        subset = oof[oof.model == name]
        ax.scatter(subset.actual_apv, subset.predicted_apv, s=20, alpha=0.65)
        ax.plot([30, 90], [30, 90], "--", color="gray")
        ax.set(title=name, xlabel="Actual APV (%)", xlim=(30, 90), ylim=(30, 90))
        ax.grid(alpha=0.2)
    axes[0].set_ylabel("Predicted APV (%)")
    fig.suptitle("Held-out predictions: first five-fold repeat, 143 matched videos")
    fig.tight_layout()
    fig.savefig(args.out / "actual_vs_predicted.png", dpi=200)
    plt.close(fig)
    lines = [
        "# Matched model comparison",
        "",
        f"{len(ids)} identical videos; 5 folds repeated 10 times. Every run uses the original APV labels.",
        "Models are retrained within each fold. Scaling uses training rows only. No tuning was performed.",
        "Original features use last year's extraction; rescanned features use the supplied export.",
        "Scene count is included in the five-feature runs, but excluded from the production eight-feature set.",
        "",
        "| Model | MAE mean ± SD | RMSE mean ± SD | R² mean ± SD |",
        "|---|---:|---:|---:|",
    ]
    for name, row in summary.iterrows():
        values = [
            f"{row[m + '_mean']:.3f} ± {row[m + '_std']:.3f}"
            for m in ["mae", "rmse", "r2"]
        ]
        lines.append("| " + name + " | " + " | ".join(values) + " |")
    lines += [
        "",
        "SD describes fold variation, not a confidence interval or significance test. Repeated folds are dependent.",
        "The prediction figure uses only the first repeat: each video is predicted once while held out.",
        f"Excluded videos: {', '.join(metadata['excluded_video_ids']) or 'none'}.",
        "The expanded features differ in both extraction and feature selection; they are not simply a superset of the original five.",
        "This analysis does not overwrite saved models or the existing comparison report.",
    ]
    (args.out / "report.md").write_text("\n".join(lines) + "\n")
    print(summary.round(4).to_string())
    print(f"\nSaved to {args.out.resolve()}")


def plot_metric_comparison(summary, out_dir):
    """Save charts of average model scores, with error bars showing fold variation."""
    names = [
        "Mean baseline",
        "Original five / Linear",
        "Expanded eight / Forest",
        "Expanded eight / Linear",
    ]
    labels = [
        "Mean\nbaseline",
        "Original 5\nLinear\nRegression",
        "Expanded 8\nRandom\nForest",
        "Expanded 8\nLinear\nRegression",
    ]
    colors = ["#8795a1", "#4779ad", "#db9237", "#37948b"]
    selected = summary.loc[names]
    fig, axes = plt.subplots(1, 3, figsize=(13, 5.4))
    for ax, metric, title in zip(
        axes,
        ["mae", "rmse", "r2"],
        ["MAE — lower is better", "RMSE — lower is better", "R² — higher is better"],
    ):
        means = selected[metric + "_mean"].to_numpy()
        sd = selected[metric + "_std"].to_numpy()
        ax.bar(
            range(4),
            means,
            yerr=sd,
            color=colors,
            capsize=4,
            error_kw={"linewidth": 1.2},
            width=0.65,
        )
        ax.set_xticks(range(4), labels, fontsize=9)
        ax.set_title(title, fontsize=12, pad=14)
        ax.set_ylabel("APV percentage points" if metric != "r2" else "R²")
        ax.set_axisbelow(True)
        ax.grid(axis="y", alpha=0.2)
        ax.spines[["top", "right"]].set_visible(False)
        if metric == "r2":
            ax.axhline(0, color="#555555", linewidth=0.8)
            ax.set_ylim(-0.4, 0.4)
        else:
            ax.set_ylim(0, float(max(means + sd)) * 1.18)
        for i, (mean, spread) in enumerate(zip(means, sd)):
            ax.annotate(
                f"{mean:.3f}",
                (i, mean + spread),
                xytext=(0, 7),
                textcoords="offset points",
                ha="center",
                fontsize=10,
                fontweight="bold",
            )
    fig.suptitle(
        "Engagement prediction: original and expanded models", fontsize=16, y=0.97
    )
    fig.text(
        0.5,
        0.885,
        "143 matched videos • identical APV labels • five-fold CV repeated 10 times",
        ha="center",
        fontsize=10,
    )
    fig.text(
        0.5,
        0.035,
        "Bars: mean across 50 folds. Error bars: ±1 fold standard deviation, not confidence intervals.",
        ha="center",
        fontsize=9,
        color="#444444",
    )
    fig.tight_layout(rect=[0, 0.08, 1, 0.86])
    for extension in ["png", "pdf"]:
        fig.savefig(out_dir / f"metric_comparison.{extension}", dpi=250)
    plt.close(fig)


if __name__ == "__main__":
    main()
