"""Check that the page's model forms work for a browser on this machine and for
nobody else. Run from the repository root:

    python -m unittest server.tests.test_model_portal

Uses the portal blueprint on a bare Flask app rather than app.py, which loads the
Whisper model when imported.
"""
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

import model_portal
from model_registry import ModelRegistry
from model_training.data_preparation import FEATURE_SETS
from tests.test_model_registry import train

LOCAL = {"REMOTE_ADDR": "127.0.0.1"}
HEADERS = {"Host": "localhost:5000", "Origin": "http://localhost:5000"}


class TestModelPortal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory()
        root = Path(cls.shared.name)
        cls.builtin = root / "builtin"
        train(cls.builtin, "full")
        cls.package = root / "video.zip"
        train(None, "video", FEATURE_SETS["video"], cls.package)

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        app = Flask(__name__)
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
        self.registry = ModelRegistry(
            self.builtin, ["full"], Path(self.directory.name) / "added", "full"
        )
        app.extensions["model_registry"] = self.registry
        app.register_blueprint(model_portal.bp)
        app.add_url_rule("/", "root", lambda: model_portal.models_card_html())
        self.client = app.test_client()

    def page(self, environ=LOCAL, host="localhost:5000"):
        return self.client.get("/", environ_base=environ, headers={"Host": host}).get_data(as_text=True)

    def token(self):
        return re.search(r'name="csrf" value="([^"]+)"', self.page()).group(1)

    def upload(self, environ=LOCAL, headers=HEADERS, token=None):
        with self.package.open("rb") as f:
            return self.client.post(
                "/models/upload",
                data={"csrf": self.token() if token is None else token, "package": (f, "video.zip")},
                environ_base=environ,
                headers=headers,
            )

    def test_local_upload_adds_the_model_and_reports_it(self):
        response = self.upload()
        self.assertEqual(response.status_code, 303)
        self.assertIn("video", [e["id"] for e in self.registry.entries()])
        page = self.client.get(
            response.headers["Location"], environ_base=LOCAL, headers={"Host": "localhost:5000"}
        ).get_data(as_text=True)
        self.assertIn("Added Video (video).", page)

    def test_refused_without_the_token(self):
        self.assertEqual(self.upload(token="").status_code, 403)
        self.assertEqual(self.upload(token="guess").status_code, 403)

    def test_refused_from_another_origin_or_site(self):
        self.assertEqual(self.upload(headers={**HEADERS, "Origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(self.upload(headers={**HEADERS, "Sec-Fetch-Site": "cross-site"}).status_code, 403)

    def test_refused_from_another_machine_even_claiming_loopback(self):
        remote = {"REMOTE_ADDR": "192.168.1.20"}
        self.assertEqual(self.upload(environ=remote).status_code, 403)
        spoofed = {**HEADERS, "X-Forwarded-For": "127.0.0.1"}
        self.assertEqual(self.upload(environ=remote, headers=spoofed).status_code, 403)
        # A local reverse proxy forwarding someone else's request.
        self.assertEqual(self.upload(headers={**HEADERS, "X-Forwarded-For": "8.8.8.8"}).status_code, 403)
        self.assertNotIn("Upload", self.page(environ=remote))

    def test_refused_under_a_rebound_hostname(self):
        headers = {"Host": "attacker.example:5000", "Origin": "http://attacker.example:5000"}
        self.assertEqual(self.upload(headers=headers).status_code, 403)

    def test_refused_when_management_is_off(self):
        token = self.token()
        with mock.patch.object(model_portal, "MODEL_MANAGEMENT", False):
            self.assertEqual(self.upload(token=token).status_code, 403)
            self.assertIn("MODEL_MANAGEMENT=0", self.page())
        self.assertEqual([e["id"] for e in self.registry.entries()], ["full"])

    def test_page_shows_the_card(self):
        page = self.page()
        self.assertIn("RandomForestRegressor", page)
        self.assertIn("Held-out accuracy", page)

    def test_page_links_to_more_models_and_offers_no_catalog(self):
        page = self.page()
        self.assertIn(f'href="{model_portal.MORE_MODELS_URL}"', page)
        self.assertNotIn('name="suggested"', page)
        # The link is for everyone, not only a browser that may add models.
        self.assertIn(model_portal.MORE_MODELS_URL, self.page(environ={"REMOTE_ADDR": "10.0.0.9"}))

    def test_message_ids_not_text_come_from_the_url(self):
        page = self.client.get(
            "/?models_msg=<script>alert(1)</script>", environ_base=LOCAL, headers={"Host": "localhost:5000"}
        ).get_data(as_text=True)
        self.assertNotIn("<script>", page)


if __name__ == "__main__":
    unittest.main()
