"""Check that a client export is read into the training table the client would build.

Uses a small hand-written manifest, so each expected value can be worked out by
hand from the numbers in it.
"""
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

# Add server/ to Python's search path so the model_training package is found
# when this test file is run directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from model_training.data_preparation import (
    FEATURE_COLUMNS,
    MIN_TRAINING_ROWS,
    TARGET_COLUMN,
    load_export_dataset,
)


def make_record(index, **overrides):
    """A record with everything a training row needs: 10 minutes, 1500 words, 20 scenes,
    watched for 6 minutes on average."""
    record = {
        "id": f"hash-{index}",
        "sort_name": f"Video {index}",
        "video_file": {"hash": f"hash-{index}", "exists_on_server": True, "duration_secs": 600},
        "youtube_content": {"content": f"yt-{index}", "average_view_duration_secs": 360},
        "transcript_stats": {
            "count_chars": 9000,
            "count_words": 1500,
            "speech_pace_variation": 12.5,
            "speaking_ratio": 0.8,
        },
        "scene_stats": {"duration_secs": 600, "scenes": 20},
        "transcript_path": None,
        "video_file_path": None,
        "audience_retention_path": None,
    }
    record.update(overrides)
    return record


def make_manifest():
    usable = [make_record(i) for i in range(MIN_TRAINING_ROWS)]
    unusable = [
        make_record(
            100,
            transcript_stats={
                "count_chars": 1,
                "count_words": 1,
                "speech_pace_variation": 1.0,
                "speaking_ratio": None,
            },
        ),
        make_record(101, youtube_content=None),
        make_record(102, scene_stats=None),
        make_record(103, scene_stats={"duration_secs": 0, "scenes": 3}),
    ]
    return {"generated_at": "2026-01-01T00:00:00.000Z", "records": usable + unusable}


class TestLoadExportDataset(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)

        self.folder = root / "export"
        self.folder.mkdir()
        manifest = json.dumps(make_manifest())
        (self.folder / "manifest.json").write_text(manifest, encoding="utf-8")

        self.zip = root / "export.zip"
        with zipfile.ZipFile(self.zip, "w") as archive:
            archive.writestr("manifest.json", manifest)
            archive.writestr("transcript/hash-0.srt", "1\n00:00:00,000 --> 00:00:01,000\nHi\n")

    def test_computes_features_and_target_as_the_client_does(self):
        df = load_export_dataset(self.folder, verbose=False)

        self.assertEqual(list(df.columns), FEATURE_COLUMNS + [TARGET_COLUMN])
        row = df.iloc[0]
        self.assertAlmostEqual(row["duration"], 10.0)  # 600 s in minutes
        self.assertAlmostEqual(row["wpm"], 150.0)  # 1500 words / 10 min
        self.assertAlmostEqual(row["scene_change_rate"], 2.0)  # 20 scenes / 10 min
        self.assertAlmostEqual(row["word_count"], 1500)
        self.assertAlmostEqual(row["speech_pace_variation"], 12.5)
        self.assertAlmostEqual(row["speaking_ratio"], 0.8)
        self.assertAlmostEqual(row[TARGET_COLUMN], 60.0)  # 360 s of 600 s

    def test_skips_records_the_client_would_skip(self):
        df = load_export_dataset(self.folder, verbose=False)
        self.assertEqual(len(df), MIN_TRAINING_ROWS)

    def test_zip_and_folder_give_the_same_table(self):
        from_folder = load_export_dataset(self.folder, verbose=False)
        from_zip = load_export_dataset(self.zip, verbose=False)
        self.assertTrue(from_folder.equals(from_zip))

    def test_rejects_too_few_usable_records(self):
        manifest = {"records": [make_record(0)]}
        (self.folder / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "usable record"):
            load_export_dataset(self.folder, verbose=False)

    def test_rejects_something_that_is_not_an_export(self):
        empty = Path(self.directory.name) / "empty"
        empty.mkdir()
        with self.assertRaisesRegex(ValueError, "manifest.json is missing"):
            load_export_dataset(empty, verbose=False)


if __name__ == "__main__":
    unittest.main()
