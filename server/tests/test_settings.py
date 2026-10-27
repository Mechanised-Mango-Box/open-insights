"""Check that the settings each result reports are the ones that made it. Run from
the repository root:

    python -m unittest server.tests.test_settings
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

# Add server/ to Python's search path so its top-level modules are found when
# this file is run directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db
from db import KINDS, SCENE_STATS, TRANSCRIPT


class TestSettingsMatchProducers(unittest.TestCase):
    """A ready result reports its kind's *current* settings. That is only true
    because a result reads as ready only while its producer is current - so
    every setting has to be in the producer, or changing it would leave old
    results reporting a value they were not made with."""

    def test_every_setting_is_in_its_producer(self):
        for kind in KINDS.values():
            for name, value in kind.settings.items():
                if isinstance(value, bool):
                    continue  # A flag is a suffix; see the next test.
                marker = f"={value}" if isinstance(value, (int, float)) else f"/{value}"
                with self.subTest(kind=kind.name, setting=name):
                    self.assertIn(marker, kind.producer)

    def test_the_voice_filter_marks_the_transcript_producer(self):
        self.assertEqual(TRANSCRIPT.producer.endswith("/vad"), TRANSCRIPT.settings["vad"])


class TestDatasetStateReportsSettings(unittest.TestCase):
    def state(self, producer):
        row = {"producer": producer, "produced_at": "t", "duration_secs": 9.0, "scenes": 2.0}
        with (
            mock.patch.object(db, "get_result", return_value=row),
            mock.patch.object(db, "get_job", return_value=None),
        ):
            return db.dataset_state(SCENE_STATS, "abc")

    def test_a_ready_result_carries_the_settings(self):
        state = self.state(SCENE_STATS.producer)
        self.assertEqual(state["state"], "ready")
        self.assertEqual(state["settings"], dict(SCENE_STATS.settings))

    def test_a_stale_result_is_absent_and_claims_no_settings(self):
        self.assertEqual(self.state("opencv/threshold=30.0"), {"state": "absent"})


if __name__ == "__main__":
    unittest.main()
