import sys
from pathlib import Path
import unittest
import numpy as np
from sklearn.linear_model import LinearRegression

# Ensure server/ directory is in sys.path when script is executed directly
server_dir = str(Path(__file__).resolve().parent.parent)
if server_dir not in sys.path:
    sys.path.insert(0, server_dir)

from model_training.regression import (
    classify_feature_relationship,
    generate_feature_recommendations,
)
from model_training.train import run_training_pipeline
from model_training.mock_data import generate_mock_training_data



class TestRecommendationLogic(unittest.TestCase):

    def test_classify_feature_relationship(self):
        # 1. Clearly positive coefficient
        self.assertEqual(classify_feature_relationship(2.5), "positive")

        # 2. Clearly negative coefficient
        self.assertEqual(classify_feature_relationship(-3.0), "negative")

        # 3. Zero coefficient
        self.assertEqual(classify_feature_relationship(0.0), "weak")

        # 4. Coefficient just below +1.0
        self.assertEqual(classify_feature_relationship(0.99), "weak")

        # 5. Coefficient just above -1.0
        self.assertEqual(classify_feature_relationship(-0.99), "weak")

        # 6. Exactly +1.0
        self.assertEqual(classify_feature_relationship(1.0), "positive")

        # 7. Exactly -1.0
        self.assertEqual(classify_feature_relationship(-1.0), "negative")

    def test_generate_feature_recommendations_wording_and_structure(self):
        model = LinearRegression()
        model.coef_ = np.array([2.5, -3.0, 0.5, -0.99, 1.2, -0.5])
        feature_names = [
            "duration",
            "wpm",
            "scene_change_rate",
            "word_count",
            "speech_pace_variation",
            "speaking_ratio",
        ]

        recs = generate_feature_recommendations(model, feature_names, threshold=1.0)

        self.assertEqual(recs["threshold"], 1.0)
        self.assertIn("features", recs)

        feats = recs["features"]
        self.assertEqual(len(feats), 6)

        # Duration: positive
        self.assertEqual(feats["duration"]["relationship"], "positive")
        self.assertEqual(
            feats["duration"]["recommendation"],
            "In this dataset, higher duration is associated with higher average percentage viewed.",
        )

        # WPM: negative
        self.assertEqual(feats["wpm"]["relationship"], "negative")
        self.assertEqual(
            feats["wpm"]["recommendation"],
            "In this dataset, higher speaking speed (WPM) is associated with lower average percentage viewed.",
        )

        # Scene change rate: weak
        self.assertEqual(feats["scene_change_rate"]["relationship"], "weak")
        self.assertEqual(
            feats["scene_change_rate"]["recommendation"],
            "In this dataset, scene change rate has little to no measurable relationship with average percentage viewed.",
        )

        # Word count: weak
        self.assertEqual(feats["word_count"]["relationship"], "weak")
        self.assertEqual(
            feats["word_count"]["recommendation"],
            "In this dataset, word count has little to no measurable relationship with average percentage viewed.",
        )

        # Speech pace variation: positive
        self.assertEqual(feats["speech_pace_variation"]["relationship"], "positive")
        self.assertEqual(
            feats["speech_pace_variation"]["recommendation"],
            "In this dataset, higher speech pace variation is associated with higher average percentage viewed.",
        )

        # Speaking ratio: weak
        self.assertEqual(feats["speaking_ratio"]["relationship"], "weak")
        self.assertEqual(
            feats["speaking_ratio"]["recommendation"],
            "In this dataset, speaking ratio has little to no measurable relationship with average percentage viewed.",
        )

    def test_pipeline_integration(self):
        mock_df = generate_mock_training_data(num_samples=50, random_state=42)
        results = run_training_pipeline(raw_df=mock_df, save_dir=None, recommendation_threshold=1.0)

        self.assertIn("recommendations", results)
        self.assertEqual(results["recommendations"]["threshold"], 1.0)
        self.assertEqual(len(results["recommendations"]["features"]), 6)


if __name__ == "__main__":
    unittest.main()
