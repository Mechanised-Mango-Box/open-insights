"""The engagement models this server can answer recommendations with.

Two places hold them:
  - built in: the BUILTIN_MODELS directories under ENGAGEMENT_MODEL_DIR (the
    repository's models/, or the frozen build's copy of them). Read-only, and
    loaded at startup so a missing or stale one stops the server at boot rather
    than 500ing the first person to ask. Other directories there are ignored.
  - added: each directory under MODELS_DIR, put there by the page at / (see
    model_portal.py). Loaded on first use.

Each directory is a model.joblib and a model.json card (model_training/model_card.py).
Listing reads only the cards, never the pickles: a model's description must be
readable without running anything it contains. A model is unpickled only when it
is added (to prove it loads before it is kept) and when it is first asked for.
"""
import hashlib
import json
import os
import shutil
import ssl
import threading
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

from inference import EngagementPredictor
from model_training.data_preparation import FEATURE_COLUMNS
from model_training.model_card import (
    BUNDLE_FILENAME,
    CARD_FILENAME,
    framework_versions,
    validate_card,
)

# Written beside an added model: when and from where it came.
_INSTALL_FILENAME = "installed.json"
_PACKAGE_FILES = {CARD_FILENAME, BUNDLE_FILENAME}
_DOWNLOAD_TIMEOUT_SECS = 60


class ModelError(ValueError):
    """A model that cannot be added, found or used. Its message is for the user."""


def _read_card(directory: Path) -> dict[str, Any] | None:
    try:
        return json.loads((directory / CARD_FILENAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def problems(card: dict[str, Any]) -> list[str]:
    """Why this server cannot run a model, or [] when it can."""
    found = validate_card(card)
    if found:
        return found
    unknown = [name for name in card["features"] if name not in FEATURE_COLUMNS]
    if unknown:
        found.append(f"Uses features this server cannot compute: {', '.join(unknown)}.")
    running = framework_versions()["scikit-learn"]
    trained = card["framework"].get("scikit-learn")
    if trained != running:
        found.append(
            f"Trained with scikit-learn {trained}; this server has {running}, "
            "which cannot reliably load it."
        )
    return found


class ModelRegistry:
    def __init__(
        self,
        builtin_dir: str | Path,
        builtin_ids: list[str],
        added_dir: str | Path,
        default_id: str,
    ) -> None:
        self.builtin_dir = Path(builtin_dir)
        self.builtin_ids = list(builtin_ids)
        self.added_dir = Path(added_dir)
        self.default_id = default_id
        self._predictors: dict[str, EngagementPredictor] = {}
        # One add or delete at a time, and no load racing either.
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ reading

    def _directories(self) -> dict[str, tuple[Path, str]]:
        """Every model directory by id, with its source. A built-in id wins over
        an added one, though add() never lets the two collide."""
        found: dict[str, tuple[Path, str]] = {}
        if self.added_dir.is_dir():
            for directory in sorted(self.added_dir.iterdir()):
                if directory.is_dir() and not directory.name.startswith("."):
                    found[directory.name] = (directory, "added")
        for model_id in self.builtin_ids:
            directory = self.builtin_dir / model_id
            if directory.is_dir():
                found[model_id] = (directory, "builtin")
        return found

    def load_builtins(self) -> None:
        """Unpickles every built-in model now. Raises if one is missing, broken,
        or the default is not among them."""
        missing = [m for m in self.builtin_ids if not (self.builtin_dir / m).is_dir()]
        if missing:
            raise FileNotFoundError(
                f"Built-in engagement model(s) {', '.join(missing)} not found in {self.builtin_dir}."
            )
        if self.default_id not in self.builtin_ids:
            raise ValueError(
                f"Default engagement model '{self.default_id}' is not one of the built-in "
                f"models ({', '.join(self.builtin_ids)})."
            )
        builtins = {m: self.builtin_dir / m for m in self.builtin_ids}
        with self._lock:
            for model_id, directory in builtins.items():
                self._predictors[model_id] = EngagementPredictor(directory)

    def entries(self) -> list[dict[str, Any]]:
        """Every model's card plus where it came from and whether it can be used,
        default first, then built-in, then added, each by name."""
        listed = []
        for model_id, (directory, source) in self._directories().items():
            card = _read_card(directory)
            if card is None:
                listed.append(
                    {
                        "id": model_id,
                        "source": source,
                        "default": model_id == self.default_id,
                        "card": None,
                        "compatible": False,
                        "problems": ["model.json is missing or unreadable."],
                    }
                )
                continue
            found = problems(card)
            if card.get("id") != model_id:
                found.append(f"Card id '{card.get('id')}' does not match its directory '{model_id}'.")
            install = {}
            if source == "added":
                try:
                    install = json.loads((directory / _INSTALL_FILENAME).read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    pass
            listed.append(
                {
                    "id": model_id,
                    "source": source,
                    "default": model_id == self.default_id,
                    "installed_at": install.get("installed_at"),
                    "origin": install.get("origin"),
                    "sha256": install.get("sha256"),
                    "card": card,
                    "compatible": not found,
                    "problems": found,
                }
            )
        order = {"builtin": 0, "added": 1}
        listed.sort(
            key=lambda e: (
                e["id"] != self.default_id,
                order[e["source"]],
                ((e["card"] or {}).get("name") or e["id"]).lower(),
            )
        )
        return listed

    def entry(self, model_id: str) -> dict[str, Any] | None:
        return next((e for e in self.entries() if e["id"] == model_id), None)

    def predictor(self, model_id: str | None) -> EngagementPredictor:
        """The loaded model, loading it on first use. Raises ModelError for an
        unknown or unusable id."""
        model_id = model_id or self.default_id
        with self._lock:
            if model_id in self._predictors:
                return self._predictors[model_id]
            entry = self.entry(model_id)
            if entry is None:
                raise ModelError(f"No engagement model '{model_id}' on this server.")
            if not entry["compatible"]:
                raise ModelError(f"Model '{model_id}' cannot be used: {' '.join(entry['problems'])}")
            directory, _ = self._directories()[model_id]
            try:
                predictor = EngagementPredictor(directory)
            except Exception as error:  # noqa: BLE001 - any unpickling failure
                raise ModelError(f"Model '{model_id}' failed to load: {error}") from error
            self._predictors[model_id] = predictor
            return predictor

    # ------------------------------------------------------------------ adding

    def add_package(self, package: Path, origin: str, sha256: str | None = None) -> dict[str, Any]:
        """Validates a model package and keeps it. Returns its card.

        The package is a .zip of exactly model.json and model.joblib. Its card is
        checked first, without unpickling; then the bundle is loaded once, in a
        scratch directory, to prove it works and matches its card. Only then is
        it moved into place, in one rename, so a half-added model never appears.
        """
        from config import MODEL_MAX_BYTES

        if not zipfile.is_zipfile(package):
            raise ModelError("Not a model package: expected a .zip of model.json and model.joblib.")
        with zipfile.ZipFile(package) as archive:
            members = archive.infolist()
            names = {member.filename for member in members}
            if names != _PACKAGE_FILES or len(members) != len(_PACKAGE_FILES):
                raise ModelError(
                    "A model package must hold exactly model.json and model.joblib, "
                    f"at its top level; this one has: {', '.join(sorted(names)) or 'nothing'}."
                )
            if sum(member.file_size for member in members) > MODEL_MAX_BYTES:
                raise ModelError(f"Package unpacks to more than {MODEL_MAX_BYTES} bytes.")
            try:
                card = json.loads(archive.read(CARD_FILENAME).decode("utf-8"))
            except ValueError as error:
                raise ModelError(f"model.json is not valid JSON: {error}") from error

            found = problems(card)
            if found:
                raise ModelError(" ".join(found))
            model_id = card["id"]

            with self._lock:
                if model_id in self._directories():
                    raise ModelError(
                        f"A model with id '{model_id}' is already on this server. "
                        "Delete it first, or give the new one another id."
                    )
                self.added_dir.mkdir(parents=True, exist_ok=True)
                scratch = self.added_dir / f".adding-{uuid4().hex}"
                scratch.mkdir()
                try:
                    # Only the two known names are ever written, so nothing in the
                    # archive chooses a path.
                    for name in _PACKAGE_FILES:
                        (scratch / name).write_bytes(archive.read(name))
                    try:
                        predictor = EngagementPredictor(scratch)
                    except Exception as error:  # noqa: BLE001 - any unpickling failure
                        raise ModelError(f"model.joblib failed to load: {error}") from error
                    if predictor.feature_columns != card["features"]:
                        raise ModelError(
                            "model.json lists different features from the model inside "
                            f"model.joblib ({', '.join(predictor.feature_columns)})."
                        )
                    (scratch / _INSTALL_FILENAME).write_text(
                        json.dumps(
                            {
                                "installed_at": datetime.now(timezone.utc)
                                .replace(microsecond=0)
                                .isoformat(),
                                "origin": origin,
                                "sha256": sha256 or _sha256(package),
                            },
                            indent=2,
                        ),
                        encoding="utf-8",
                    )
                    os.replace(scratch, self.added_dir / model_id)
                except BaseException:
                    shutil.rmtree(scratch, ignore_errors=True)
                    raise
                self._predictors[model_id] = predictor
        return card

    def add_from_url(self, url: str, expected_sha256: str | None = None) -> dict[str, Any]:
        """Downloads a model package over HTTPS and adds it. When a SHA-256 is
        given, a download that does not match it is refused before it is opened."""
        from config import MODEL_MAX_BYTES

        if urlsplit(url).scheme != "https":
            raise ModelError("Only https:// URLs can be downloaded.")
        expected = (expected_sha256 or "").strip().lower() or None
        self.added_dir.mkdir(parents=True, exist_ok=True)
        download = self.added_dir / f".download-{uuid4().hex}.zip"
        try:
            digest = hashlib.sha256()
            size = 0
            opener = urllib.request.build_opener(
                urllib.request.HTTPSHandler(context=_ssl_context()), _HttpsOnlyRedirects()
            )
            try:
                with opener.open(url, timeout=_DOWNLOAD_TIMEOUT_SECS) as response, download.open(
                    "wb"
                ) as out:
                    while chunk := response.read(1024 * 1024):
                        size += len(chunk)
                        if size > MODEL_MAX_BYTES:
                            raise ModelError(f"Download is larger than {MODEL_MAX_BYTES} bytes.")
                        digest.update(chunk)
                        out.write(chunk)
            except ModelError:
                raise
            except Exception as error:  # noqa: BLE001 - network failures of every kind
                raise ModelError(f"Could not download {url}: {error}") from error
            actual = digest.hexdigest()
            if expected and actual != expected:
                raise ModelError(
                    f"Downloaded file's SHA-256 is {actual}, not the expected {expected}. "
                    "It was not added."
                )
            return self.add_package(download, origin=url, sha256=actual)
        finally:
            download.unlink(missing_ok=True)

    def delete(self, model_id: str) -> None:
        with self._lock:
            found = self._directories().get(model_id)
            if found is None:
                raise ModelError(f"No model '{model_id}' on this server.")
            directory, source = found
            if source != "added":
                raise ModelError("Built-in models cannot be deleted.")
            self._predictors.pop(model_id, None)
            shutil.rmtree(directory)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _ssl_context() -> ssl.SSLContext:
    """certifi's roots when present: a frozen build may not find the system's."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


class _HttpsOnlyRedirects(urllib.request.HTTPRedirectHandler):
    """Follows redirects (release downloads always redirect) but never to plain HTTP."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl).scheme != "https":
            raise ModelError(f"Refusing to follow a redirect to a non-HTTPS URL: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)
