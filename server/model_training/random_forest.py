import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

from model_training.data_preparation import load_export_dataset


# The dataset is a client export (folder or .zip), passed on the command line:
#   python -m model_training.random_forest <export>
# load_export_dataset() already leaves out any video without an average
# percentage viewed.
if len(sys.argv) != 2:
    sys.exit("usage: python -m model_training.random_forest <export folder or .zip>")
dataset = load_export_dataset(sys.argv[1])

# X contains the video features/predictors that the model learns from.
feature_columns = [
    "duration",
    "wpm",
    "scene_change_rate",
    "word_count",
    "speech_pace_variation",
    "speaking_ratio",
]
X = dataset[feature_columns]

# y contains the number that we are trying to predict.
y = dataset["average_percentage_viewed"]

# Train on 80% of the videos and reserve 20% for testing.
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42,
)

# A regressor is used because average percentage viewed is a number.
rf = RandomForestRegressor(random_state=42)
rf.fit(X_train, y_train)

# Predict the average percentage viewed for every video in the test set.
y_pred = rf.predict(X_test)

r2_scores = r2_score(y_test, y_pred)
mean_abs_error = mean_absolute_error(y_test, y_pred)
mean_sqr_error = mean_squared_error(y_test, y_pred)
root_mean_sqr_error = np.sqrt(mean_sqr_error)

results = pd.DataFrame(
    {
        "Actual APV": y_test,
        "Predicted APV": y_pred,
    }
)

print(results)
print(f"R² Score: {r2_scores:.3f}")
print(f"Mean Absolute Error: {mean_abs_error:.3f}")
print(f"Mean Squared Error: {mean_sqr_error:.3f}")
print(f"Root Mean Squared Error: {root_mean_sqr_error:.3f}")


# ---------------------------------------------------------------------------
# PRINT ONE VIDEO'S PREDICTED AVERAGE PERCENTAGE VIEWED
# ---------------------------------------------------------------------------

# iloc[[0]] keeps the first test video as a one-row DataFrame.
# RandomForestRegressor.predict() expects a table, even for one video.
example_video = X_test.iloc[[0]]

# predict() returns an array. [0] takes the prediction for our one video.
predicted_apv = rf.predict(example_video)[0]

# During testing, we can also display the real APV for comparison.
actual_apv = y_test.iloc[0]

# iloc[0] changes the one-row DataFrame into a Series, making its values
# straightforward to print by column name.
video_features = example_video.iloc[0]

# These rating ranges are display rules chosen by the project team.
if predicted_apv >= 80:
    rating = "EXCELLENT"
elif predicted_apv >= 60:
    rating = "GOOD"
elif predicted_apv >= 40:
    rating = "MODERATE"
else:
    rating = "LOW"

print("\nVIDEO ENGAGEMENT ANALYSIS")
print("-" * 48)
print(f"Duration:       {video_features['duration']:.1f} minutes")
print(f"Speaking pace:  {video_features['wpm']:.0f} WPM")
print(
    f"Visual changes: "
    f"{video_features['scene_change_rate']:.1f} changes/min"
)
print(f"Word count:     {video_features['word_count']:.0f}")
print("-" * 48)
print(f"Predicted Average Percentage Viewed: {predicted_apv:.1f}%")
print(f"Rating: {rating}")
print(f"Actual Average Percentage Viewed:    {actual_apv:.1f}%")
