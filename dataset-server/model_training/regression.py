"""
Regression Model Module.

Estimates the relationship between video features and user engagement:
    Engagement = b0 + b1(duration) + b2(wpm) + b3(scene_change_rate) + b4(word_count)
where:
    - Engagement is represented by average_percentage_viewed.
    - Each coefficient represents the influence of a video feature.
"""
from typing import Tuple, Dict, Any
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler


def build_model() -> LinearRegression:
    """Instantiates a new LinearRegression model."""
    return LinearRegression()

############# Could and maybe should seperate this out into two different functions
def fit_scaler_and_train_model(
    X_train: pd.DataFrame,
    y_train: pd.Series,
) -> Tuple[LinearRegression, StandardScaler]:
    """
    Fits the StandardScaler on X_train and trains the LinearRegression model.
    Avoids data leakage by scaling only after splitting.
    """
    scaler = StandardScaler()

    # Applies the Z-scalar formula to every single data point so they can be directly compared
    X_train_scaled = scaler.fit_transform(X_train)

    model = build_model()
    # Trains the linear regression 
    model.fit(X_train_scaled, y_train)  

    return model, scaler


def predict_engagement(
    model: LinearRegression,
    scaler: StandardScaler,
    X: pd.DataFrame,
) -> np.ndarray:
    """Predicts engagement scores for given features using trained model and fitted scaler."""
    X_scaled = scaler.transform(X)
    return model.predict(X_scaled)


def get_coefficient_summary(
    model: LinearRegression,
    feature_names: list,
) -> Dict[str, Any]:
    """Returns a formatted dictionary of intercept and feature coefficients of our multiple linear regression model"""
    coef_dict = {
        feature_name: float(coef)
        for feature_name, coef in zip(feature_names, model.coef_)
    }
    return {
        "intercept (b0)": float(model.intercept_),
        "coefficients": coef_dict,
    }