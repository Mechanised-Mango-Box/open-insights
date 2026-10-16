"""Exploratory corrected paired MAE test using saved repeated-CV scores.

Run from server/: python -m model_training.statistical_significance
No models are retrained. Only the previously discussed comparison is tested.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import scipy
from scipy.stats import t

SOURCE = "https://scikit-learn.org/stable/auto_examples/model_selection/plot_grid_search_stats.html"
BASELINE = "Original five / Linear"
PROPOSED = "Expanded eight / Forest"


def corrected_test(differences, test_train_ratio):
    """Estimate mean error reduction, correcting for overlapping CV training sets."""
    differences = np.asarray(differences, dtype=float)
    n = len(differences)
    variance = differences.var(ddof=1)
    if n < 2 or not np.isfinite(differences).all() or variance <= 0:
        raise ValueError("Need at least two finite, nonconstant paired differences.")
    mean = differences.mean()
    standard_error = np.sqrt((1 / n + test_train_ratio) * variance)
    statistic = mean / standard_error
    df = n - 1
    margin = t.ppf(0.975, df) * standard_error
    return {
        "mean_mae_reduction_pp": float(mean),
        "paired_difference_sd_pp": float(np.sqrt(variance)),
        "corrected_standard_error_pp": float(standard_error),
        "ci_95_lower_pp": float(mean - margin),
        "ci_95_upper_pp": float(mean + margin),
        "t_statistic": float(statistic),
        "degrees_of_freedom": df,
        "p_value_two_sided": float(2 * t.sf(abs(statistic), df)),
    }


def main():
    """Validate paired folds, run one exploratory test and save the result and report."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=Path("build/matched_comparison"))
    args = parser.parse_args()
    directory = args.dir
    scores = pd.read_csv(directory / "fold_metrics.csv")
    assignments = pd.read_csv(directory / "test_fold_assignments.csv")
    metadata = json.loads((directory / "method.json").read_text())
    keys = ["repeat", "fold"]
    if scores.duplicated(["model"] + keys).any():
        raise ValueError("Duplicate model/fold scores.")
    baseline = scores[scores.model == BASELINE].set_index(keys)["mae"].sort_index()
    proposed = scores[scores.model == PROPOSED].set_index(keys)["mae"].sort_index()
    sizes = assignments.groupby(keys).size().sort_index()
    expected = metadata["folds"] * metadata["repeats"]
    if len(baseline) != expected or not baseline.index.equals(proposed.index) or not baseline.index.equals(sizes.index):
        raise ValueError("Both models and assignments must cover the same expected folds.")
    if assignments.duplicated(["repeat", "video_id"]).any():
        raise ValueError("A video occurs more than once per repeat.")
    if not assignments.groupby("repeat").size().eq(metadata["rows"]).all():
        raise ValueError("Fold assignments do not cover the expected video count.")
    if not baseline.index.get_level_values("repeat").unique().size == metadata["repeats"]:
        raise ValueError("Unexpected repeat count.")
    ratios = sizes / (metadata["rows"] - sizes)
    if not ((sizes > 0) & (sizes < metadata["rows"])).all():
        raise ValueError("Invalid test-fold sizes.")
    paired = pd.DataFrame({"baseline_mae": baseline, "proposed_mae": proposed,
                           "test_rows": sizes, "train_rows": metadata["rows"] - sizes})
    paired["mae_reduction_pp"] = paired.baseline_mae - paired.proposed_mae
    result = corrected_test(paired.mae_reduction_pp, ratios.mean())
    result.update({
        "baseline": BASELINE, "proposed": PROPOSED, "metric": "MAE",
        "baseline_mean_mae": float(baseline.mean()),
        "proposed_mean_mae": float(proposed.mean()),
        "relative_mae_reduction_percent": float(100 * (baseline.mean() - proposed.mean()) / baseline.mean()),
        "paired_folds": expected, "mean_test_train_ratio": float(ratios.mean()),
        "folds_with_lower_proposed_mae": int((paired.mae_reduction_pp > 0).sum()),
        "alpha": 0.05, "significant_at_005": result["p_value_two_sided"] < 0.05,
        "analysis": "Exploratory: comparison and metric selected after inspecting results.",
        "method": "Nadeau-Bengio corrected paired t-test; SE = sqrt((1/N + mean(n_test/n_train)) * sample_variance(differences)); df = N-1",
        "correction_note": "Mean actual test/train ratio accounts for fold sizes of 28 or 29 among 143 videos.",
        "source": SOURCE, "scipy_version": scipy.__version__,
    })
    paired.to_csv(directory / "significance_paired_mae.csv")
    (directory / "significance_result.json").write_text(json.dumps(result, indent=2) + "\n")
    interpretation = (
        "The corrected two-sided test does not establish a statistically significant MAE difference at alpha = 0.05."
        if not result["significant_at_005"] else
        "The corrected two-sided test identifies a statistically significant MAE difference at alpha = 0.05, subject to the exploratory design and test assumptions."
    )
    report = f"""# Exploratory statistical comparison

Compared **{BASELINE}** with **{PROPOSED}** on the same {metadata['rows']} videos and {expected} paired held-out folds.

| Measure | Result |
|---|---:|
| Original regression mean MAE | {baseline.mean():.4f} pp |
| Expanded forest mean MAE | {proposed.mean():.4f} pp |
| Mean MAE reduction (positive favours forest) | {result['mean_mae_reduction_pp']:.4f} pp |
| Relative MAE reduction | {result['relative_mae_reduction_percent']:.2f}% |
| Corrected approximate 95% confidence interval | [{result['ci_95_lower_pp']:.4f}, {result['ci_95_upper_pp']:.4f}] pp |
| Corrected t statistic (df = {result['degrees_of_freedom']}) | {result['t_statistic']:.4f} |
| Two-sided p-value | {result['p_value_two_sided']:.4f} |
| Folds with lower forest MAE (descriptive only) | {result['folds_with_lower_proposed_mae']} / {expected} |

{interpretation}

## Method and limitations

- Used the [Nadeau-Bengio corrected paired t-test]({SOURCE}), an approximate correction for overlapping repeated-CV training sets. Differences are original regression MAE minus expanded forest MAE. The null hypothesis is zero mean difference; the alternative is a difference in either direction.
- Corrected SE = sqrt((1/N + mean(test_rows/train_rows)) * sample variance of paired differences). N = {expected}; mean test/train ratio = {ratios.mean():.6f}; degrees of freedom = {expected - 1}. The 95% interval uses the same corrected SE.
- MAE is the sole tested metric and this is the sole tested model pair. No search over tests was performed. The analysis is exploratory because the comparison and metric were selected after viewing results; alpha = 0.05 is an analysis threshold, not a preregistered one.
- Fold reuse is handled approximately, not eliminated. The test assumes paired differences can be adequately modelled with this corrected t procedure. It does not supply validation on independent courses or lecturers.
- A nonsignificant result does not prove equal performance. The interval describes uncertainty in the error difference; practical importance must be considered separately.
- Features and extraction methods differ, so the test cannot isolate a benefit from nonlinear modelling. No causal conclusions follow.
- No models were retrained or overwritten. Inputs are the current saved fold metrics and assignments; original package versions are in method.json.
"""
    (directory / "significance_report.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
