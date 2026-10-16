"""Rank eight features by held-out permutation importance for both algorithms.

From server/: python -m model_training.permutation_analysis
Uses saved matched data and folds. Does not replace any saved app model.
"""

import argparse
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.utils import Bunch

# Let VS Code run this file directly, as well as with python -m.
SERVER_DIR = Path(__file__).resolve().parents[1]
if not __package__:
    sys.path.insert(0, str(SERVER_DIR))

from model_training.data_preparation import FEATURE_COLUMNS, TARGET_COLUMN

LABELS = {
    "duration": "Duration",
    "wpm": "Speaking\nspeed",
    "scene_change_rate": "Scene\nchange rate",
    "word_count": "Word\ncount",
    "speech_pace_variation": "Speaking pace\nvariation",
    "speech_ratio": "Speech\nratio",
    "text_density": "Text\ndensity",
    "mean_pause_secs": "Mean pause\nlength",
}


def main():
    """Load data, shuffle test features, and save ranked importance plots and scores."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir", type=Path, default=SERVER_DIR / "build" / "matched_comparison"
    )
    parser.add_argument("--shuffles", type=int, default=10)
    args = parser.parse_args()
    if args.shuffles < 2:
        parser.error("Use at least two shuffles per feature.")

    # Match features and original engagement labels by video ID, not row number.
    directory = args.data_dir
    features = pd.read_csv(directory / "expanded_matched.csv").set_index("video_id")
    original = pd.read_csv(directory / "original_matched.csv").set_index("video_id")
    if not features.index.is_unique or not original.index.is_unique:
        raise ValueError("Duplicate video IDs.")
    if set(features.index) != set(original.index):
        raise ValueError("Both datasets must contain the same videos.")
    X = features[FEATURE_COLUMNS].sort_index()
    y = original.loc[X.index, TARGET_COLUMN]
    if not np.isfinite(X.to_numpy()).all() or not np.isfinite(y).all():
        raise ValueError("Missing or nonfinite feature values or APV labels.")
    assignments = pd.read_csv(directory / "test_fold_assignments.csv")
    if assignments.duplicated(["repeat", "video_id"]).any():
        raise ValueError("A video is assigned to more than one test fold per repeat.")
    for _, repeat in assignments.groupby("repeat"):
        if set(repeat.video_id) != set(X.index):
            raise ValueError("Each repeat must cover all matched videos.")

    output = directory / "permutation_importance"
    output.mkdir(exist_ok=True)
    rows, accuracy = [], []

    folds = list(assignments.groupby(["repeat", "fold"], sort=True))
    for name in ["Linear Regression", "Random Forest"]:
        print(f"Analysing {name}: {len(folds)} held-out folds...", flush=True)
        for number, ((repeat, fold), records) in enumerate(folds):
            # These are the exact same test groups as the earlier comparison.
            test = X.index.isin(records.video_id)
            if not test.any() or test.all():
                raise ValueError("Invalid training/test partition.")
            if name == "Linear Regression":
                model = make_pipeline(StandardScaler(), LinearRegression())
            else:
                model = RandomForestRegressor(random_state=42, n_jobs=1)
            # Fit only on training videos. No retraining during feature shuffling.
            model.fit(X.loc[~test], y.loc[~test])
            baseline_mae = mean_absolute_error(y.loc[test], model.predict(X.loc[test]))
            accuracy.append(
                {"model": name, "repeat": repeat, "fold": fold, "mae": baseline_mae}
            )

            # Negative MAE is a score where higher is better. Its decrease equals
            # shuffled MAE minus normal MAE, so positive importance means worse error.
            result = permutation_importance(
                model,
                X.loc[test],
                y.loc[test],
                scoring="neg_mean_absolute_error",
                n_repeats=args.shuffles,
                random_state=42 + number,
                n_jobs=1,
            )
            # One scoring metric returns a Bunch; multiple metrics return a dict.
            if not isinstance(result, Bunch):
                raise TypeError("Expected permutation results for one scoring metric.")
            for index, feature in enumerate(FEATURE_COLUMNS):
                rows.append(
                    {
                        "model": name,
                        "repeat": repeat,
                        "fold": fold,
                        "feature": feature,
                        "mae_increase_mean": result.importances_mean[index],
                        "shuffle_sd": result.importances_std[index],
                    }
                )
        print(f"Finished {name}.", flush=True)

    # Average shuffles within each fold first, then calculate mean and SD over folds.
    results = pd.DataFrame(rows)
    summary = (
        results.groupby(["model", "feature"])["mae_increase_mean"]
        .agg(mean_mae_increase="mean", fold_sd="std")
        .reset_index()
    )
    summary = summary.sort_values(
        ["model", "mean_mae_increase"], ascending=[True, False]
    )
    summary["rank"] = summary.groupby("model").cumcount() + 1
    results.to_csv(output / "fold_importances.csv", index=False)
    summary.to_csv(output / "ranked_importance.csv", index=False)
    pd.DataFrame(accuracy).to_csv(output / "baseline_fold_mae.csv", index=False)
    plot_importance(summary, output, len(X), len(folds), args.shuffles)
    metadata = {
        "rows": len(X),
        "evaluation_folds": len(folds),
        "shuffles_per_feature_per_fold": args.shuffles,
        "score": "shuffled MAE minus normal held-out MAE",
        "error_bars": "Sample SD of fold mean importances; not confidence intervals",
        "sklearn_version": sklearn.__version__,
        "source": "https://scikit-learn.org/stable/modules/permutation_importance.html",
    }
    (output / "method.json").write_text(json.dumps(metadata, indent=2))
    notes = [
        "# Held-out permutation importance",
        "",
        "Both algorithms use all eight features and the original APV labels, with the saved evaluation folds.",
        f"Each feature is shuffled {args.shuffles} times per test fold. The trained model stays fixed while shuffling.",
        "A positive value means shuffling increases MAE; near zero means little measured contribution; negative means shuffling improves MAE.",
        "Error bars are sample standard deviations across fold means, not confidence intervals or significance tests.",
        "",
        "## Ranked results",
        "",
        "| Model | Feature | Increase in MAE, mean ± fold SD (pp) |",
        "|---|---|---:|",
    ]
    for row in summary.itertuples():
        notes.append(
            f"| {row.model} | {row.feature} | {row.mean_mae_increase:.3f} ± {row.fold_sd:.3f} |"
        )
    notes += [
        "",
        "## Interpretation limits",
        "These are model reliance estimates, not causal effects, regression coefficients or proof of intrinsic feature value.",
        "Duration, word count and WPM are closely related. Shuffling one alone can create unrealistic videos, breaking relationships among features. Importance can be distorted, especially for offsetting linear coefficients; large values do not necessarily imply strong real-world predictive power.",
        "Related inputs can also substitute for each other, reducing individual importance. A grouped shuffle or feature removal analysis would provide useful follow-up evidence.",
        "Both models have limited held-out predictive performance. Interpret these rankings as exploratory evidence about these fitted models and this dataset.",
        "These results must not be used to select features and then report performance on the same folds as an unbiased new estimate.",
    ]
    (output / "report.md").write_text("\n".join(notes) + "\n")
    print(summary.to_string(index=False))
    print(f"\nPlots and tables saved in {output.resolve()}")


def plot_importance(summary, output, count, folds, shuffles):
    """Draw two plots, each ordered from greatest to smallest model reliance."""
    fig, axes = plt.subplots(1, 2, figsize=(15, 7))
    for ax, name, color in zip(
        axes, ["Linear Regression", "Random Forest"], ["#4779ad", "#db9237"]
    ):
        values = summary[summary.model == name].sort_values("rank")
        positions = np.arange(len(values))
        ax.bar(
            positions,
            values.mean_mae_increase,
            yerr=values.fold_sd,
            color=color,
            capsize=3,
            width=0.65,
            label="Mean increase ± fold SD",
        )
        ax.set_xticks(
            positions,
            [LABELS[f] for f in values.feature],
            rotation=35,
            ha="right",
            fontsize=9,
        )
        ax.set_title(name + " — eight features", fontsize=13)
        ax.set_ylabel("Increase in MAE after shuffling (APV percentage points)")
        ax.axhline(0, color="#444444", linewidth=0.8)
        ax.set_axisbelow(True)
        ax.grid(axis="y", alpha=0.2)
        ax.spines[["top", "right"]].set_visible(False)
        ax.legend(fontsize=9)
    fig.suptitle("Permutation importance: which features help predict engagement?", fontsize=18, y=0.97)
    fig.text(
        0.5,
        0.91,
        f"{count} videos • {folds} held-out folds • {shuffles} shuffles per feature per fold",
        ha="center",
        fontsize=11,
    )
    fig.text(
        0.5,
        0.105,
        "Higher bars show greater model reliance. Each panel is ranked separately and uses its own vertical scale.",
        ha="center",
        fontsize=10,
    )
    fig.text(
        0.5,
        0.065,
        "Error bars show fold variation, not confidence intervals. Correlated features can distort individual importance.",
        ha="center",
        fontsize=10,
    )
    fig.text(
        0.5,
        0.025,
        "These are predictive contributions, not causal effects or the direction of an association with engagement.",
        ha="center",
        fontsize=10,
    )
    fig.tight_layout(rect=(0.0, 0.16, 1.0, 0.87))
    fig.savefig(output / "ranked_feature_importance.png", dpi=220)
    fig.savefig(output / "ranked_feature_importance.svg")
    plt.close(fig)


if __name__ == "__main__":
    main()
