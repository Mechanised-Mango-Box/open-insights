"""Check that a video row without its file is reported as missing rather than
queued, and that /status names any package whose version could not be read.
Run from the repository root:

    python -m unittest server.tests.test_routes

The two come apart whenever a database is carried over from another server: it
names every video that server held and brings none of their bytes. The row used
to be taken as proof the file was there, so the client was told the video had
been uploaded, never re-uploaded it, and every scan it then asked for failed in a
worker with "No such file or directory".

Uses the api blueprint on a bare Flask app rather than app.py, and stubs
processing, which loads the Whisper model when imported.
"""
import sqlite3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask

HASH = "25d649863d8ca9d968e16a01a46daf3fa87b99a8039ac6976d628f9396c34cb9"

# Stubbed before routes is imported: it reads SUBMIT and queue_status from here,
# and importing the real module builds a WhisperModel from weights a checkout
# does not carry. Each SUBMIT entry records what it was asked to start, which is
# what these tests assert was *not* started.
_submitted: list[tuple[str, str]] = []
_processing = types.ModuleType("processing")
_processing.SUBMIT = {
    name: (lambda name: lambda file_hash, file_path: _submitted.append((name, file_hash)))(name)
    for name in ("transcript", "scene_stats", "text_stats", "audio_stats")
}
_processing.queue_status = lambda: {"queue": {"queued": 0, "running": 0}, "workers": {}}
sys.modules.setdefault("processing", _processing)

import auth
import db
import routes
from db import KINDS, init_db


class TestMissingVideoFile(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.uploads = root / "uploads"
        self.uploads.mkdir()
        _submitted.clear()

        # Both modules read these as module globals at call time, so patching
        # them here is enough - no environment or config reload needed.
        self.enterContext(mock.patch.object(db, "DB_PATH", str(root / "db.sqlite")))
        self.enterContext(mock.patch.object(routes, "UPLOAD_FOLDER", str(self.uploads)))

        app = Flask(__name__)
        auth.install(app)
        app.teardown_appcontext(db.close_db)
        app.register_blueprint(routes.bp)
        with app.app_context():
            init_db()
        self.client = app.test_client()

        # A row for a video, with no bytes behind it: a database brought from
        # elsewhere, exactly as the one this was found on.
        conn = sqlite3.connect(str(root / "db.sqlite"))
        conn.execute(
            "INSERT INTO files (file_hash, file_ext, uploaded_at) VALUES (?, 'mp4', ?)",
            (HASH, "2026-09-17 08:31:11"),
        )
        conn.commit()
        conn.close()

    def _store_scene_stats(self, producer):
        """A scene_stats result for the row, as an import would carry it."""
        conn = sqlite3.connect(str(db.DB_PATH))
        conn.execute(
            "INSERT INTO scene_stats (file_hash, duration_secs, scenes, producer,"
            " produced_at) VALUES (?, 597.8, 42, ?, '2026-10-06 04:15:46')",
            (HASH, producer),
        )
        conn.commit()
        conn.close()

    def test_the_video_probe_reports_a_row_without_its_file_as_missing(self):
        # This 404 is what the client's sourceStatus() turns into an upload.
        response = self.client.get(f"/api/videos/{HASH}")
        self.assertEqual(response.status_code, 404)
        self.assertIn("not on this server", response.get_json()["err"])

    def test_the_video_probe_still_finds_a_video_that_is_there(self):
        (self.uploads / f"{HASH}.mp4").write_bytes(b"pretend video")
        response = self.client.get(f"/api/videos/{HASH}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["file_hash"], HASH)

    def test_work_is_refused_rather_than_queued_when_the_file_is_gone(self):
        response = self.client.post(f"/api/videos/{HASH}/audio_stats")
        self.assertEqual(response.status_code, 404)
        self.assertIn("upload it again", response.get_json()["err"])
        # The point of the 404: nothing was handed to a worker that could only
        # have failed on it.
        self.assertEqual(_submitted, [])

    def test_an_imported_result_is_still_served_without_the_file(self):
        """The reason the check is not in _resolve(): reading results computed on
        another server is why a database gets carried over in the first place."""
        self._store_scene_stats(KINDS["scene_stats"].producer)

        peek = self.client.get(f"/api/videos/{HASH}/scene_stats")
        self.assertEqual(peek.status_code, 200)
        self.assertEqual(peek.get_json()["state"], "ready")
        self.assertEqual(peek.get_json()["scenes"], 42)

        # The client opens every fetch with a POST, so that must not 404 either
        # when there is a current result to hand back.
        post = self.client.post(f"/api/videos/{HASH}/scene_stats")
        self.assertEqual(post.status_code, 200)
        self.assertEqual(post.get_json()["state"], "ready")
        self.assertEqual(_submitted, [])

    def test_a_stale_imported_result_without_the_file_is_refused(self):
        """The case that caused the failures: a result whose producer no longer
        matches reads as absent, so a POST would queue a recompute - and a
        recompute needs the bytes the database did not bring."""
        self._store_scene_stats("opencv/threshold=30.0")

        response = self.client.post(f"/api/videos/{HASH}/scene_stats")
        self.assertEqual(response.status_code, 404)
        self.assertIn("upload it again", response.get_json()["err"])
        self.assertEqual(_submitted, [])

    def test_work_is_queued_normally_when_the_file_is_there(self):
        (self.uploads / f"{HASH}.mp4").write_bytes(b"pretend video")
        response = self.client.post(f"/api/videos/{HASH}/audio_stats")
        self.assertEqual(response.status_code, 202)
        self.assertEqual(_submitted, [("audio_stats", HASH)])

    def test_an_unknown_hash_still_says_it_was_never_uploaded(self):
        """Distinct from the message above: nothing was ever here, so there is
        nothing to re-upload and no result to come looking for."""
        response = self.client.get(f"/api/videos/{'0' * 64}")
        self.assertEqual(response.status_code, 404)
        self.assertIn("No uploaded video found", response.get_json()["err"])


class TestStatus(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        auth.install(app)
        app.register_blueprint(routes.bp)
        self.client = app.test_client()

    def test_a_server_that_can_read_every_version_reports_none_missing(self):
        with mock.patch.object(routes, "UNVERSIONED_PACKAGES", []):
            body = self.client.get("/status").get_json()
        self.assertEqual(body["unversioned_packages"], [])
        self.assertEqual(body["status"], "ok")

    def test_a_package_whose_version_cannot_be_read_is_named(self):
        """What a portable build without faster-whisper's dist-info looked like:
        it scanned fine and stamped every result "faster-whisper-missing"."""
        with mock.patch.object(routes, "UNVERSIONED_PACKAGES", ["faster-whisper"]):
            body = self.client.get("/status").get_json()
        self.assertEqual(body["unversioned_packages"], ["faster-whisper"])


if __name__ == "__main__":
    unittest.main()
