"""Check that model packages are validated before they are kept, and that the
registry answers with the model asked for. Run from the repository root:

    python -m unittest server.tests.test_model_registry
"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from model_registry import ModelError, ModelRegistry, problems
from model_training.data_preparation import FEATURE_SETS, TARGET_COLUMN
from model_training.mock_data import generate_mock_training_data
from model_training.train import run_training_pipeline


def train(directory: Path, model_id: str, features=None, package: Path | None = None) -> dict:
    """Trains a model on mock data into directory/<id> and optionally a package."""
    df = generate_mock_training_data(num_samples=40, random_state=1)
    with contextlib.redirect_stdout(io.StringIO()):
        results = run_training_pipeline(
            raw_df=df,
            save_dir=str(directory / model_id) if directory else None,
            features=features,
            meta={"id": model_id, "name": model_id.title()},
            package_path=str(package) if package else None,
        )
    return results["card"]


def rewrite_card(package: Path, **changes) -> None:
    with zipfile.ZipFile(package) as archive:
        card = json.loads(archive.read("model.json"))
        bundle = archive.read("model.joblib")
    card.update(changes)
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("model.json", json.dumps(card))
        archive.writestr("model.joblib", bundle)


class TestModelRegistry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory()
        root = Path(cls.shared.name)
        cls.builtin = root / "builtin"
        train(cls.builtin, "full")
        # Committed beside the built-ins but not one of them, like models/video.
        train(cls.builtin, "spare", FEATURE_SETS["video"])
        cls.video_package = root / "video.zip"
        train(None, "video", FEATURE_SETS["video"], cls.video_package)

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.registry = ModelRegistry(self.builtin, ["full"], self.root / "added", "full")
        self.registry.load_builtins()

    def package(self, **changes) -> Path:
        copy = self.root / "copy.zip"
        copy.write_bytes(self.video_package.read_bytes())
        if changes:
            rewrite_card(copy, **changes)
        return copy

    def test_lists_builtin_default_first(self):
        self.registry.add_package(self.package(), origin="test")
        entries = self.registry.entries()
        self.assertEqual([e["id"] for e in entries], ["full", "video"])
        self.assertTrue(entries[0]["default"])
        self.assertEqual(entries[1]["source"], "added")
        self.assertTrue(all(e["compatible"] for e in entries))

    def test_added_subset_model_predicts_from_its_own_features(self):
        self.registry.add_package(self.package(), origin="test")
        predictor = self.registry.predictor("video")
        result = predictor.predict(
            {"duration": 10, "scene_change_rate": 2, "text_density": 30, "wpm": 999}
        )
        self.assertIn(TARGET_COLUMN, result)
        self.assertEqual(sorted(result["features"]), sorted(FEATURE_SETS["video"]))
        with self.assertRaises(ValueError):
            predictor.predict({"duration": 10, "scene_change_rate": 2})

    def test_default_answers_when_no_model_named(self):
        self.assertIs(self.registry.predictor(None), self.registry.predictor("full"))

    def test_unknown_model(self):
        with self.assertRaisesRegex(ModelError, "No engagement model"):
            self.registry.predictor("missing")

    def test_rejects_duplicate_id(self):
        with self.assertRaisesRegex(ModelError, "already on this server"):
            self.registry.add_package(self.package(id="full"), origin="test")

    def test_rejects_bad_card(self):
        for changes, message in (
            ({"format_version": 99}, "format_version"),
            ({"id": "../escape"}, "id must be"),
            ({"features": []}, "features must be"),
            ({"features": ["duration", "not_a_feature"]}, "cannot compute"),
        ):
            with self.subTest(changes=changes):
                with self.assertRaisesRegex(ModelError, message):
                    self.registry.add_package(self.package(**changes), origin="test")
        self.assertFalse(any(self.root.joinpath("added").glob("*")))

    def test_rejects_card_that_disagrees_with_its_bundle(self):
        package = self.package(features=["duration", "wpm", "text_density"])
        with self.assertRaisesRegex(ModelError, "different features"):
            self.registry.add_package(package, origin="test")
        self.assertFalse(any(self.root.joinpath("added").glob("*")))

    def test_rejects_other_scikit_learn(self):
        card = json.loads(zipfile.ZipFile(self.video_package).read("model.json"))
        framework = {**card["framework"], "scikit-learn": "0.1.0"}
        with self.assertRaisesRegex(ModelError, "scikit-learn 0.1.0"):
            self.registry.add_package(self.package(framework=framework), origin="test")
        self.assertIn("scikit-learn 0.1.0", " ".join(problems({**card, "framework": framework})))

    def test_rejects_wrong_or_extra_files(self):
        bad = self.root / "bad.zip"
        with zipfile.ZipFile(bad, "w") as archive:
            archive.writestr("model.json", "{}")
            archive.writestr("model.joblib", b"")
            archive.writestr("../evil.py", "print('hi')")
        with self.assertRaisesRegex(ModelError, "exactly model.json and model.joblib"):
            self.registry.add_package(bad, origin="test")
        not_zip = self.root / "not.zip"
        not_zip.write_text("hello")
        with self.assertRaisesRegex(ModelError, "Not a model package"):
            self.registry.add_package(not_zip, origin="test")
        self.assertFalse((self.root / "evil.py").exists())

    def test_delete_only_added(self):
        self.registry.add_package(self.package(), origin="test")
        self.registry.delete("video")
        self.assertEqual([e["id"] for e in self.registry.entries()], ["full"])
        with self.assertRaisesRegex(ModelError, "Built-in"):
            self.registry.delete("full")

    def test_download_checks_scheme_and_hash(self):
        with self.assertRaisesRegex(ModelError, "https"):
            self.registry.add_from_url("http://example.org/model.zip")

        payload = self.video_package.read_bytes()

        class FakeResponse(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        opener = mock.Mock()
        opener.open.side_effect = lambda *a, **k: FakeResponse(payload)
        with mock.patch("urllib.request.build_opener", return_value=opener):
            with self.assertRaisesRegex(ModelError, "SHA-256"):
                self.registry.add_from_url("https://example.org/video.zip", "0" * 64)
            self.assertEqual([e["id"] for e in self.registry.entries()], ["full"])

            import hashlib

            digest = hashlib.sha256(payload).hexdigest()
            card = self.registry.add_from_url("https://example.org/video.zip", digest.upper())
        self.assertEqual(card["id"], "video")
        entry = self.registry.entry("video")
        self.assertEqual(entry["origin"], "https://example.org/video.zip")
        self.assertEqual(entry["sha256"], digest)
        self.assertFalse(list(self.root.joinpath("added").glob(".download-*")))

    def test_serves_only_the_listed_builtins(self):
        self.assertNotIn("spare", [e["id"] for e in self.registry.entries()])
        with self.assertRaisesRegex(ModelError, "No engagement model 'spare'"):
            self.registry.predictor("spare")
        both = ModelRegistry(self.builtin, ["full", "spare"], self.root / "added", "full")
        both.load_builtins()
        self.assertEqual([e["id"] for e in both.entries()], ["full", "spare"])

    def test_missing_builtin_fails_at_boot(self):
        registry = ModelRegistry(self.builtin, ["full", "nope"], self.root / "added", "full")
        with self.assertRaisesRegex(FileNotFoundError, "nope"):
            registry.load_builtins()

    def test_default_must_be_a_builtin(self):
        registry = ModelRegistry(self.builtin, ["full"], self.root / "added", "spare")
        with self.assertRaisesRegex(ValueError, "not one of the built-in"):
            registry.load_builtins()


if __name__ == "__main__":
    unittest.main()
