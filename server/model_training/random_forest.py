import pandas as pd
from sklearn.model_selection import train_test_split 
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import accuracy_score, classification_report
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

import warnings 


warnings.filterwarnings('ignore')

mock_data = pd.read_csv('fyp_mock_training_data.csv')

# dropping any video where we dont have the avg perecentage viewed
mock_data = mock_data.dropna(subset=['average_percentage_viewed'])

X = mock_data[[ 'duration_mins', 'wpm', 'word_count', 'scene_count', 'scene_change_rate', 'text_density', 'silence_rate']] #X is our predictors
y = mock_data['average_percentage_viewed'] # Y is what we're trying to predict


X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42) # test size 0.2 means testing on 20% and training on 80% of the data

rf = RandomForestRegressor(random_state=42)

rf.fit(X_train, y_train)

y_pred = rf.predict(X_test)

rf.score(X_test, y_test)

r2_scores = r2_score(y_test, y_pred)
mean_abs_error = mean_absolute_error(y_test, y_pred)
mean_sqr_error = mean_squared_error(y_test, y_pred)

results = pd.DataFrame({
    'Actual APV': y_test,
    'Predicted APV': y_pred
})

print (results)
print(f"R² Score: {r2_scores:.3f}")
print(f"Mean Absolute Error: {mean_abs_error:.3f}")
print(f"Mean Squared Error: {mean_sqr_error:.3f}")











