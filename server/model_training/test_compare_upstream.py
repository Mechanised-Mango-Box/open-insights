"""Check the comparison against upstream EduVideo Insights and its AAEE 2025 paper.

The paper-reproduction test reads the committed upstream dataset in
data/sample/edu-video-insights/, so it needs no export. The join tests use a small
hand-written manifest, as test_export_dataset.py does.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

# Add server/ to Python's search path so the model_training package is found
# when this test file is run directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from model_training.compare_upstream import (
    DEFAULT_UPSTREAM_DIR,
    PAPER_FEATURES,
    PAPER_R2,
    PAPER_RMSE,
    PAPER_WEIGHTS,
    align,
    load_project,
    load_studio_reports,
    load_upstream,
    model_rows,
    paper_protocol,
)
from model_training.data_preparation import TARGET_COLUMN
from model_training.test_export_dataset import make_record


class TestReproducesThePaper(unittest.TestCase):
    def setUp(self):
        self.upstream = load_upstream(DEFAULT_UPSTREAM_DIR)

    def test_upstream_gradient_descent_gives_the_papers_model(self):
        result = paper_protocol(self.upstream, PAPER_FEATURES, solver="gd")
        for feature in PAPER_FEATURES:
            self.assertEqual(round(result["weights"][feature], 2), PAPER_WEIGHTS[feature], feature)
        self.assertEqual(round(result["rmse"], 1), PAPER_RMSE)
        self.assertEqual(round(result["r2"], 4), PAPER_R2)

    def test_studio_reports_hold_the_target_verbatim(self):
        studio = load_studio_reports(DEFAULT_UPSTREAM_DIR / "upstream_raw").reindex(self.upstream.index)
        self.assertFalse(studio["studio_apv"].isna().any(), "a video is missing from the Studio reports")
        pd.testing.assert_series_equal(
            studio["studio_apv"], self.upstream[TARGET_COLUMN], check_names=False, atol=0.005
        )


class TestJoin(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.export = Path(self.directory.name)
        manifest = {"records": [make_record(1), make_record(0), make_record(2, youtube_content=None)]}
        (self.export / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    def upstream(self, video_ids):
        return pd.DataFrame(
            {column: 1.0 for column in PAPER_FEATURES + [TARGET_COLUMN]},
            index=pd.Index(video_ids, name="video_id"),
        )

    def test_project_rows_are_keyed_by_youtube_id(self):
        project, skipped = load_project(self.export)
        self.assertEqual(list(project.index), ["yt-1", "yt-0"])
        self.assertEqual(project.loc["yt-0", "scene_count"], 20)
        self.assertEqual(skipped["no YouTube average view duration"], 1)

    def test_a_video_with_no_pause_is_kept_for_the_paper_comparisons(self):
        record = make_record(3)
        record["audio_stats"] = {**record["audio_stats"], "mean_pause_secs": None}
        manifest = {"records": [make_record(0), record]}
        (self.export / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        project, skipped = load_project(self.export)
        self.assertEqual(list(project.index), ["yt-0", "yt-3"])
        self.assertTrue(pd.isna(project.loc["yt-3", "mean_pause_secs"]))
        self.assertEqual(list(model_rows(project).index), ["yt-0"])
        self.assertEqual(sum(skipped.values()), 0)

    def test_upstream_is_put_in_export_order(self):
        project, _ = load_project(self.export)
        upstream, project = align(self.upstream(["yt-0", "yt-1"]), project)
        self.assertEqual(list(upstream.index), list(project.index))

    def test_names_every_video_only_one_side_has(self):
        project, _ = load_project(self.export)
        with self.assertRaisesRegex(ValueError, "missing from the export: yt-9") as raised:
            align(self.upstream(["yt-0", "yt-9"]), project)
        self.assertIn("not in upstream's dataset: yt-1", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
