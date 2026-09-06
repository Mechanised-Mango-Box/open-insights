import numpy as np
import pandas as pd


def generate_mock_training_data(num_samples: int = 200, random_state: int = 42) -> pd.DataFrame:

    rng = np.random.default_rng(random_state)

    # Video duration in minutes
    duration = rng.uniform(5, 60, num_samples)

    # Speaking rate
    wpm = rng.normal(150, 20, num_samples)
    wpm = np.clip(wpm, 90, 220)

    # Scene changes per minute
    scene_change_rate = rng.uniform(0.5, 8, num_samples)

    # Word count should logically depend on duration and WPM
    word_count = duration * wpm

    # Simulated relationship between video properties and engagement
    average_percentage_viewed = (
        85
        - 0.5 * duration
        - 0.08 * np.abs(wpm - 150)
        + 1.5 * scene_change_rate
        + rng.normal(0, 5, num_samples)
    )

    # YouTube percentage viewed should stay between 0 and 100
    average_percentage_viewed = np.clip(
        average_percentage_viewed,
        0,
        100,
    )

    return pd.DataFrame({
        "duration": duration,
        "wpm": wpm,
        "scene_change_rate": scene_change_rate,
        "word_count": word_count,
        "average_percentage_viewed": average_percentage_viewed,
    }) 

