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

            # Check that each feature's relationship comes from the linear
            # regression model. The training results call this model 'model'.
            expected = generate_feature_recommendations(trained['model'], FEATURE_COLUMNS)
            self.assertEqual(result['threshold'], expected['threshold'])
            for index, name in enumerate(FEATURE_COLUMNS):
                feature = result['features'][name]
                for key in ('coefficient', 'relationship', 'recommendation'):
                    self.assertEqual(feature[key], expected['features'][name][key])

                # The video's own value, set against the average the scaler saw.
                self.assertAlmostEqual(feature['value'], features[name])
                self.assertAlmostEqual(feature['training_mean'], trained['scaler'].mean_[index])
                self.assertAlmostEqual(
                    feature['contribution'], feature['coefficient'] * feature['z_score']
                )

                # A suggestion to change a feature only ever points at something
                # currently costing APV, and a weak relationship suggests nothing.
                if feature['suggestion'] in ('increase', 'decrease'):
                    self.assertLess(feature['contribution'], 0)
                self.assertEqual(feature['suggestion'] == 'none', feature['relationship'] == 'weak')

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

    def test_places_the_video_against_its_training_data(self):
        df = generate_mock_training_data(num_samples=50, random_state=42)
        with tempfile.TemporaryDirectory() as directory:
            run_training_pipeline(raw_df=df, save_dir=directory)
            predictor = EngagementPredictor(directory)
            features = df[FEATURE_COLUMNS].iloc[0].to_dict()
            result = predictor.predict(features)

            distribution = predictor.card['training_distribution']
            self.assertGreaterEqual(result['target_percentile'], 0)
            self.assertLessEqual(result['target_percentile'], 100)
            for name in FEATURE_COLUMNS:
                feature = result['features'][name]
                self.assertGreaterEqual(feature['training_percentile'], 0)
                self.assertLessEqual(feature['training_percentile'], 100)

                # The curve sweeps the whole training range, and passes through
                # this video's own value at exactly its prediction.
                curve = feature['expected_curve']
                edges = distribution['features'][name]['histogram']['edges']
                self.assertAlmostEqual(curve['x'][0], min(edges[0], features[name]))
                self.assertAlmostEqual(curve['x'][-1], max(edges[-1], features[name]))
                self.assertEqual(curve['x'], sorted(curve['x']))
                self.assertEqual(len(curve['x']), len(curve['apv']))
                at_value = curve['apv'][curve['x'].index(features[name])]
                self.assertAlmostEqual(at_value, result[TARGET_COLUMN])

    def test_card_without_training_distribution(self):
        # Models trained before the distribution existed still predict, and
        # leave out what they cannot say.
        df = generate_mock_training_data(num_samples=50, random_state=42)
        with tempfile.TemporaryDirectory() as directory:
            run_training_pipeline(raw_df=df, save_dir=directory)
            predictor = EngagementPredictor(directory)
            del predictor.card['training_distribution']
            result = predictor.predict(df[FEATURE_COLUMNS].iloc[0].to_dict())
            self.assertNotIn('target_percentile', result)
            for feature in result['features'].values():
                self.assertNotIn('training_percentile', feature)
                self.assertNotIn('expected_curve', feature)

    def test_missing_bundle(self):
        # Make an empty folder without training or saving any models into it.
        with tempfile.TemporaryDirectory() as directory:
            # Loading from it must report that the saved bundle is missing.
            with self.assertRaises(FileNotFoundError):
                EngagementPredictor(directory)


if __name__ == '__main__':
    # Run the tests and print their results when this file is executed directly.
    unittest.main()
