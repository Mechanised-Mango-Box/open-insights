"""Check the training-data summary a model card carries, and the percentiles
read off it. Uses fake data: these tests check the arithmetic, not the models.
"""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from model_training.data_preparation import FEATURE_COLUMNS, TARGET_COLUMN
from model_training.mock_data import generate_mock_training_data
from model_training.training_distribution import (
    MIN_VIDEOS_PER_BIN,
    QUANTILE_LEVELS,
    percentile_of,
    summarise_training_data,
    validate_distribution,
)


class TestTrainingDistribution(unittest.TestCase):
    def setUp(self):
        df = generate_mock_training_data(num_samples=60, random_state=3)
        self.X = df[FEATURE_COLUMNS]
        self.y = df[TARGET_COLUMN]
        self.summary = summarise_training_data(self.X, self.y, FEATURE_COLUMNS)

    def test_histograms_match_numpy_and_count_every_row(self):
        for name in FEATURE_COLUMNS:
            histogram = self.summary["features"][name]["histogram"]
            counts, edges = np.histogram(self.X[name], bins=self.summary["bins"])
            self.assertEqual(histogram["counts"], counts.tolist())
            np.testing.assert_allclose(histogram["edges"], edges)
            self.assertEqual(sum(histogram["counts"]), len(self.X))

    def test_quantiles_never_decrease_and_span_the_data(self):
        for name in FEATURE_COLUMNS:
            quantiles = self.summary["features"][name]["quantiles"]
            self.assertEqual(len(quantiles), len(QUANTILE_LEVELS))
            self.assertTrue(all(a <= b for a, b in zip(quantiles, quantiles[1:])))
            self.assertAlmostEqual(quantiles[0], self.X[name].min())
            self.assertAlmostEqual(quantiles[-1], self.X[name].max())

    def test_sparse_bins_hide_their_viewing(self):
        for name in FEATURE_COLUMNS:
            histogram = self.summary["features"][name]["histogram"]
            for i, count in enumerate(histogram["counts"]):
                p25, median, p75 = (
                    histogram[key][i] for key in ("target_p25", "target_median", "target_p75")
                )
                if count < MIN_VIDEOS_PER_BIN:
                    self.assertEqual((p25, median, p75), (None, None, None))
                else:
                    self.assertLessEqual(p25, median)
                    self.assertLessEqual(median, p75)

    def test_target_summary_has_no_viewing_quartiles(self):
        # The target's own histogram is APV against APV; quartiles would say nothing.
        self.assertNotIn("target_median", self.summary["target"]["histogram"])

    def test_percentile_of(self):
        quantiles = list(np.linspace(0, 100, len(QUANTILE_LEVELS)))
        self.assertEqual(percentile_of(-1, quantiles), 0)
        self.assertEqual(percentile_of(101, quantiles), 100)
        self.assertAlmostEqual(percentile_of(42.5, quantiles), 42.5)
        # A run of equal quantiles (many tied values) lands in its middle.
        tied = [0.0] * 5 + [1.0] * 16
        self.assertAlmostEqual(percentile_of(0.0, tied), 10)
        self.assertAlmostEqual(percentile_of(1.0, tied), 62.5)

    def test_percentile_tracks_the_real_fraction_below(self):
        for name in FEATURE_COLUMNS:
            quantiles = self.summary["features"][name]["quantiles"]
            for value in self.X[name].sample(10, random_state=0):
                exact = 100 * (self.X[name] < value).mean()
                self.assertLess(abs(percentile_of(value, quantiles) - exact), 6)

    def test_validate_distribution(self):
        self.assertEqual(validate_distribution(self.summary), [])
        self.assertTrue(validate_distribution([]))
        broken = {**self.summary, "target": {"quantiles": [1, 2], "histogram": {}}}
        self.assertTrue(validate_distribution(broken))

    def test_constant_column(self):
        X = pd.DataFrame({"duration": [5.0] * 10})
        summary = summarise_training_data(X, pd.Series(range(10), dtype=float), ["duration"])
        self.assertEqual(percentile_of(5.0, summary["features"]["duration"]["quantiles"]), 50)


if __name__ == "__main__":
    unittest.main()
