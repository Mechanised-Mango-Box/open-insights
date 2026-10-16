"""Check that a video row without its file is reported as missing rather than
queued, that /status names any package whose version could not be read, and who
may train a model through POST /api/models/train. Run from the repository root:

    python -m unittest server.tests.test_routes

The two come apart whenever a database is carried over from another server: it
names every video that server held and brings none of their bytes. The row used
to be taken as proof the file was there, so the client was told the video had
been uploaded, never re-uploaded it, and every scan it then asked for failed in a
worker with "No such file or directory".

Uses the api blueprint on a bare Flask app rather than app.py, and stubs
processing, which loads the Whisper model when imported.
"""
import contextlib
import io
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
from model_registry import ModelRegistry
from model_training.data_preparation import FEATURE_SETS
from model_training.mock_data import generate_mock_training_data
from model_training.train import run_training_pipeline
from tests.test_model_registry import mock_manifest


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



class TestTrainModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory()
        cls.builtin = Path(cls.shared.name) / "builtin"
        with contextlib.redirect_stdout(io.StringIO()):
            run_training_pipeline(
                raw_df=generate_mock_training_data(num_samples=40, random_state=1),
                save_dir=str(cls.builtin / "full"),
                meta={"id": "full", "name": "Full"},
            )
        cls.manifest = mock_manifest()

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        added = Path(directory.name) / "added"
        self.registry = ModelRegistry(self.builtin, ["full"], added, "full")
        self.registry.load_builtins()

    def client(self, keys: bool = False):
        """An app with the api blueprint. With keys, callers need one: "public" or
        "private" - the cloud deployment. Without, every caller is private - a
        server run locally."""
        for name, value in {
            "AUTH_ENABLED": keys,
            "PUBLIC_API_KEY": "public" if keys else "",
            "PRIVATE_API_KEY": "private" if keys else "",
        }.items():
            self.enterContext(mock.patch.object(auth, name, value))
        app = Flask(__name__)
        app.extensions["model_registry"] = self.registry
        auth.install(app)
        app.register_blueprint(routes.bp)
        if keys:
            # One limiter for every app: start each test's public tier afresh.
            auth.limiter.reset()
        return app.test_client()

    def train(self, client, model_id: str, key: str | None = None):
        return client.post(
            "/api/models/train",
            json={
                "manifest": self.manifest,
                "features": FEATURE_SETS["lite"],
                "meta": {"id": model_id, "name": model_id.title()},
            },
            headers={"X-API-Key": key} if key else {},
        )

    def test_a_local_server_trains_without_a_key(self):
        response = self.train(self.client(), "mine")
        self.assertEqual(response.status_code, 201, response.get_json())
        body = response.get_json()
        self.assertEqual(body["model"]["id"], "mine")
        self.assertTrue(body["model"]["compatible"])
        self.assertEqual(body["used_rows"], 40)
        self.assertEqual(body["skipped"], {})
        listed = self.client().get("/api/models").get_json()
        self.assertTrue(listed["can_train"])
        self.assertIn("mine", [m["id"] for m in listed["models"]])

    def test_the_public_key_may_train(self):
        response = self.train(self.client(keys=True), "mine", key="public")
        self.assertEqual(response.status_code, 201, response.get_json())

    def test_no_key_is_refused_when_keys_are_configured(self):
        self.assertEqual(self.train(self.client(keys=True), "mine").status_code, 401)

    def test_the_public_tier_is_capped_and_the_private_one_is_not(self):
        client = self.client(keys=True)
        with mock.patch.object(routes, "PUBLIC_MAX_TRAINED_MODELS", 1):
            self.assertEqual(self.train(client, "first", key="public").status_code, 201)
            refused = self.train(client, "second", key="public")
            self.assertEqual(refused.status_code, 503)
            self.assertIsNone(self.registry.entry("second"))
            self.assertEqual(self.train(client, "third", key="private").status_code, 201)

    def test_the_public_tier_is_rate_limited_and_the_private_one_is_not(self):
        client = self.client(keys=True)
        allowed = int(routes.PUBLIC_TRAIN_RATE_LIMIT.split()[0])
        for index in range(allowed):
            self.assertEqual(self.train(client, f"public-{index}", key="public").status_code, 201)
        self.assertEqual(self.train(client, "one-more", key="public").status_code, 429)
        self.assertEqual(self.train(client, "private", key="private").status_code, 201)

    def test_a_taken_id_is_a_conflict(self):
        client = self.client()
        self.assertEqual(self.train(client, "full").status_code, 409)

    def test_a_bad_request_says_why(self):
        client = self.client()
        response = client.post("/api/models/train", json={"manifest": {"records": []}})
        self.assertEqual(response.status_code, 400)
        self.assertIn("features", response.get_json()["err"])
        self.assertEqual(client.post("/api/models/train", data="nope").status_code, 400)

    def test_training_can_be_turned_off(self):
        client = self.client()
        with mock.patch.object(routes, "MODEL_TRAINING", False):
            self.assertEqual(self.train(client, "mine").status_code, 403)
            self.assertFalse(client.get("/api/models").get_json()["can_train"])


if __name__ == "__main__":
    unittest.main()
