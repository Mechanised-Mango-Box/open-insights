from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split


# Path(__file__) makes sure Python finds the CSV inside model_training,
# regardless of which folder the terminal command is run from.
csv_path = Path(__file__).with_name("fyp_mock_training_data.csv")
mock_data = pd.read_csv(csv_path)

# Dropping any video where we do not have the average percentage viewed.
mock_data = mock_data.dropna(subset=["average_percentage_viewed"])

# X contains the video features/predictors that the model learns from.
feature_columns = [
    "duration_mins",
    "wpm",
    "scene_change_rate",
    "word_count",
]
X = mock_data[feature_columns]

# y contains the number that we are trying to predict.
y = mock_data["average_percentage_viewed"]

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
print(f"Duration:       {video_features['duration_mins']:.1f} minutes")
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
