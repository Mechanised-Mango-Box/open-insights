"""Check scene counting, and that a video OpenCV cannot decode is counted by PyAV
rather than reported as having no scenes. Run from the repository root:

    python -m unittest server.tests.test_scene_stats
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

# Add server/ to Python's search path so its top-level modules are found when
# this file is run directly, and this folder for the shared fixtures.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import scene_stats
from scene_stats import calculate_scene_stats, count_scene_transitions
from video_fixtures import HAS_AV1_ENCODER, write_av1, write_mjpeg

# Dark, bright, dark: two cuts over 9 s.
SEGMENTS = [(3, 40), (3, 220), (3, 40)]


class TestCountSceneTransitions(unittest.TestCase):
    def test_counts_consecutive_frames_that_differ_past_the_threshold(self):
        frames = [np.full((4, 4, 3), level, dtype=np.uint8) for level in (0, 0, 100, 110, 0)]
        # 0 -> 100 and 110 -> 0 cross 30; 100 -> 110 does not.
        self.assertEqual(count_scene_transitions(frames, 30.0), (2, 5))


class TestCalculateSceneStats(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def path(self, name):
        return Path(self.directory.name) / name

    def test_counts_cuts_and_reads_duration(self):
        video = self.path("cuts.avi")
        write_mjpeg(video, SEGMENTS)
        stats = calculate_scene_stats(video)
        self.assertEqual(stats.scenes, 2.0)
        self.assertAlmostEqual(stats.duration_secs, 9.0)

    def test_falls_back_to_pyav_when_opencv_reads_nothing(self):
        video = self.path("cuts.avi")
        write_mjpeg(video, SEGMENTS)
        # What an AV1 file does under an OpenCV that can only decode it in hardware.
        with mock.patch.object(scene_stats, "_opencv_frames", return_value=iter(())):
            stats = calculate_scene_stats(video)
        self.assertEqual(stats.scenes, 2.0)
        self.assertAlmostEqual(stats.duration_secs, 9.0)

    @unittest.skipUnless(HAS_AV1_ENCODER, "this PyAV has no AV1 encoder")
    def test_counts_an_av1_video(self):
        # No mock: on a machine without AV1 hardware this is the real failure,
        # and on one with it OpenCV reads the file itself. Either way, 2 cuts.
        video = self.path("cuts.mp4")
        write_av1(video, SEGMENTS)
        stats = calculate_scene_stats(video)
        self.assertEqual(stats.scenes, 2.0)
        self.assertAlmostEqual(stats.duration_secs, 9.0)

    def test_a_file_nothing_can_decode_is_an_error_not_zero_scenes(self):
        junk = self.path("junk.mp4")
        junk.write_bytes(b"not a video")
        with self.assertRaises(RuntimeError):
            calculate_scene_stats(junk)


if __name__ == "__main__":
    unittest.main()
