"""Check that saved models produce the expected predictions and feedback.

These tests use fake data to check the code works. They do not measure how
accurately the models predict engagement for real videos.
"""
import sys
import tempfile
import unittest
from pathlib import Path

# Add server/ to Python's search path so it can find inference.py and the
# model_training package when we run this test file directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from inference import EngagementPredictor
from model_training.data_preparation import FEATURE_COLUMNS, TARGET_COLUMN
from model_training.mock_data import generate_mock_training_data
from model_training.regression import generate_feature_recommendations
from model_training.train import run_training_pipeline


class TestInference(unittest.TestCase):
    # unittest finds methods whose names start with test_ and runs each one.
    def test_saved_forest_prediction_and_linear_feedback(self):
        # Make 50 fake video records. A fixed random_state makes the generated
        # data repeatable, so each test run uses the same examples.
        df = generate_mock_training_data(num_samples=50, random_state=42)

        # Save test models in a temporary folder, which is automatically deleted
        # when this block finishes. This leaves our actual saved models alone.
        with tempfile.TemporaryDirectory() as directory:
            # Train both models and save their bundle to the temporary folder.
            # 'trained' also holds the original models for comparison below.
            trained = run_training_pipeline(raw_df=df, save_dir=directory)

            # Load the saved bundle, just as the server would at startup.
            predictor = EngagementPredictor(directory)

            # Select the first video's input features. Double brackets in
            # iloc[[0]] keep it as a one-row table, which the forest expects.
            frame = df[FEATURE_COLUMNS].iloc[[0]]

            # Turn that row into a dictionary and deliberately reverse its key
            # order. Inference should put features back into training order.
            features = dict(reversed(list(frame.iloc[0].to_dict().items())))
            result = predictor.predict(features)

            # Check that inference returns the original random forest's APV
            # prediction. [0] picks the only prediction in its output array.
            # assertAlmostEqual allows tiny decimal rounding differences.
            self.assertAlmostEqual(
                result[TARGET_COLUMN], trained['random_forest'].predict(frame)[0]
            )

            # Check that feedback comes from the linear regression model.
            # The training results call this model 'model'. assertEqual checks
            # that the returned feedback matches the expected feedback exactly.
            self.assertEqual(result['recommendations'], generate_feature_recommendations(
                trained['model'], FEATURE_COLUMNS
            ))

            # Try missing features, the wrong input type, a boolean, NaN
            # ('not a number'), and a negative count. **features copies the
            # valid dictionary before replacing one value with an invalid one.
            for invalid in ({}, [], {**features, 'wpm': True},
                            {**features, 'duration': float('nan')},
                            {**features, 'word_count': -1}):
                # Each bad input must raise ValueError. If it is accepted,
                # assertRaises marks this test as failed.
                with self.assertRaises(ValueError):
                    predictor.predict(invalid)

    def test_missing_bundle(self):
        # Make an empty folder without training or saving any models into it.
        with tempfile.TemporaryDirectory() as directory:
            # Loading from it must report that the saved bundle is missing.
            with self.assertRaises(FileNotFoundError):
                EngagementPredictor(directory)


if __name__ == '__main__':
    # Run the tests and print their results when this file is executed directly.
    unittest.main()
