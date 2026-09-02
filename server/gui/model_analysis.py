import pandas as pd
from imgui_bundle import imgui, imgui_fig
from matplotlib.figure import Figure

from model_training.data_analysis import generate_full_analysis_report
from model_training.mock_data import generate_mock_training_data  # TEMP
from typedef.video import Video
from universe import Universe
from utils import Failure, Result, Success

__plots: dict[str, Figure] | None = None


def build_page(u: Universe):
    global __plots
    if imgui.button("Run Analysis"):
        # print("[ Analysis Test ] Generating mock data for visualization test...")
        # df_test = generate_mock_training_data(num_samples=200, random_state=42)
        match videos_to_training_data(u.entities):
            case Failure(err):
                print(f"err: {err}")
            case Success(training_data):
                __plots = generate_full_analysis_report(
                    training_data, save_dir="models/analysis_plots"
                )
                print("[ Analysis Test ] All 3 analysis visualizations created successfully!")

    imgui.separator()

    if __plots is None:
        imgui.text("Run analysis first.")
    else:
        import matplotlib

        matplotlib.use("Agg")
        for title, fig in __plots.items():
            imgui_fig.fig(title, fig)


def videos_to_training_data(videos: list[Video]) -> Result[pd.DataFrame, str]:
    duration: list[float] = []
    scene_change_rate: list[float] = []
    wpm: list[float] = []
    word_count: list[int] = []
    average_percentage_viewed: list[float] = []

    for i in range(len(videos)):
        v = videos[i]
        if v.ds_opencv_scene_stats is None:
            return Failure("[ Analysis ] Missing scene stats")
        # Video duration in minutes
        duration.append(v.ds_opencv_scene_stats.duration_minutes)
        # Scene changes per minute
        scene_change_rate.append(v.ds_opencv_scene_stats.scene_transition_rate)

        if v.ds_transcript_stats is None:
            return Failure("[ Analysis ] Missing transcript stats")
        # Speaking rate
        wpm.append(v.ds_transcript_stats.word_count / duration[i])
        # Word count
        word_count.append(v.ds_transcript_stats.word_count)

        if v.ds_yt_content is None:
            return Failure("[ Analysis ] Missing YT content")
        if v.ds_yt_content.average_view_duration is None:
            return Failure("[ Analysis ] Missing YT content -> average view duration")
        # Engagement
        average_percentage_viewed.append(
            v.ds_yt_content.average_view_duration / duration[i]
        )

    return Success(
        pd.DataFrame(
            {
                "duration": duration,
                "wpm": wpm,
                "scene_change_rate": scene_change_rate,
                "word_count": word_count,
                "average_percentage_viewed": average_percentage_viewed,
            }
        )
    )
