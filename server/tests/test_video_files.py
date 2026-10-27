"""Check what the upload route accepts as a video. Run from the repository root:

    python -m unittest server.tests.test_video_files
"""
import sys
import tempfile
import unittest
from pathlib import Path

# Add server/ to Python's search path so its top-level modules are found when
# this file is run directly, and this folder for the shared fixtures.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import ALLOWED_EXTENSIONS
from utils import Failure, Success
from video_files import DEMUXERS, check_video
from video_fixtures import HAS_AV1_ENCODER, write_audio_only, write_av1, write_mjpeg

SEGMENTS = [(1, 40), (1, 220)]


class TestCheckVideo(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def path(self, name):
        return Path(self.directory.name) / name

    def test_every_accepted_extension_names_a_container(self):
        self.assertEqual(set(DEMUXERS), ALLOWED_EXTENSIONS)

    def test_accepts_a_video_in_the_container_its_name_says(self):
        video = self.path("clip.avi")
        write_mjpeg(video, SEGMENTS)
        self.assertEqual(check_video(video, "avi"), Success("mjpeg"))

    @unittest.skipUnless(HAS_AV1_ENCODER, "this PyAV has no AV1 encoder")
    def test_accepts_av1(self):
        video = self.path("clip.mp4")
        write_av1(video, SEGMENTS)
        self.assertEqual(check_video(video, "mp4"), Success("av1"))
        # .mp4 and .mov are one container to FFmpeg, and to every reader here.
        self.assertEqual(check_video(video, "mov"), Success("av1"))

    def test_rejects_a_video_named_for_another_container(self):
        video = self.path("clip.avi")
        write_mjpeg(video, SEGMENTS)
        result = check_video(video, "mp4")
        self.assertIsInstance(result, Failure)
        self.assertIn("AVI", result.error)

    def test_rejects_a_file_that_is_not_a_video(self):
        junk = self.path("notes.mp4")
        junk.write_bytes(b"these are my lecture notes, not a video")
        self.assertIsInstance(check_video(junk, "mp4"), Failure)

    def test_rejects_an_empty_file(self):
        empty = self.path("empty.mp4")
        empty.write_bytes(b"")
        self.assertIsInstance(check_video(empty, "mp4"), Failure)

    def test_rejects_audio_with_no_video(self):
        audio = self.path("talk.mkv")
        write_audio_only(audio)
        result = check_video(audio, "mkv")
        self.assertIsInstance(result, Failure)
        self.assertIn("no video", result.error)


if __name__ == "__main__":
    unittest.main()
