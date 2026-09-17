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

    # Speech pace variation (standard deviation of WPM across 30s windows, non-negative)
    speech_pace_variation = np.clip(rng.normal(25, 10, num_samples), 0.0, None)

    # Speaking ratio (portion of video duration with speech, between 0.0 and 1.0)
    speaking_ratio = np.clip(rng.normal(0.75, 0.15, num_samples), 0.0, 1.0)

    # Simulated relationship between video properties and engagement
    average_percentage_viewed = (
        85
        - 0.5 * duration
        - 0.08 * np.abs(wpm - 150)
        + 1.5 * scene_change_rate
        - 0.3 * speech_pace_variation
        + 5.0 * speaking_ratio
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
        "speech_pace_variation": speech_pace_variation,
        "speaking_ratio": speaking_ratio,
        "average_percentage_viewed": average_percentage_viewed,
    }) 

