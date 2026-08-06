"""
This file will contain the regression model for training. We are using average percentage viewed as the engagement proxy.
The model estimates the relationship as:
Engagement =
        b0 +
        b1(duration) +
        b2(wpm) +
        b3(scene_change_rate) +
        b4(word_count)
where:
    - Engagement is represented by average percentage viewed.
    - Each coefficient represents the influence of a video feature.

"""