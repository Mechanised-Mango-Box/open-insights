"""The "Engagement models" section of the page at /, and the forms behind it.

Lists every model the server holds with its full card, and - for a browser on
this machine only - adds models (an uploaded package, a package downloaded from
an https URL, or one of the published ones) and deletes added ones.

Why so guarded: a model is a pickle, and unpickling runs whatever code its
author put in it. The page at / needs no API key (see auth.py), and a plain HTML
form can POST to http://localhost:5000 from any website without a CORS
preflight - so without these checks, any page the user visited could plant code
on their machine. Every POST here requires all of:
  - MODEL_MANAGEMENT on (docker-compose.yml turns it off),
  - the TCP peer is loopback, read from before ProxyFix rewrote it, with no
    forwarding header (a reverse proxy on this machine would otherwise make
    every visitor look local),
  - a loopback Host header (defeats DNS rebinding),
  - an Origin, when the browser sends one, that is this server, and
  - this process's CSRF token, which only a page served by this server knows.
"""
import hmac
import html
import ipaddress
import secrets
import tempfile
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from flask import Blueprint, abort, current_app, redirect, request

from config import MODEL_MANAGEMENT, SUGGESTED_MODELS
from model_registry import ModelError, ModelRegistry

bp = Blueprint("model_portal", __name__)

# Fresh each start, so a token copied out of an old page is worthless.
_CSRF_TOKEN = secrets.token_urlsafe(32)

_LOOPBACK_NAMES = {"localhost"}

# The outcome of the last few form posts, by an id the redirect carries, so the
# page never renders text that arrived in its own URL.
_messages: dict[str, tuple[bool, str]] = {}
_messages_lock = threading.Lock()
_MAX_MESSAGES = 32


def _registry() -> ModelRegistry:
    return current_app.extensions["model_registry"]


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    if host.lower() in _LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def _peer_address() -> str | None:
    """The address that actually opened the connection - not the one ProxyFix
    took from X-Forwarded-For, which any client can write."""
    original = request.environ.get("werkzeug.proxy_fix.orig") or {}
    return original.get("REMOTE_ADDR") or request.environ.get("REMOTE_ADDR")


def can_manage() -> bool:
    """Whether this request may see and use the add/delete forms."""
    if not MODEL_MANAGEMENT:
        return False
    if request.headers.get("X-Forwarded-For") or request.headers.get("Forwarded"):
        return False
    return _is_loopback(_peer_address()) and _is_loopback(urlsplit(f"//{request.host}").hostname)


def _check_post() -> None:
    if not can_manage():
        abort(403, description="Models can only be managed from a browser on this machine.")
    origin = request.headers.get("Origin")
    if origin is not None and origin != request.host_url.rstrip("/"):
        abort(403, description="Cross-origin request refused.")
    # Sent by every current browser: a form posted from another site says so.
    if request.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
        abort(403, description="Cross-site request refused.")
    token = request.form.get("csrf", "")
    if not hmac.compare_digest(token, _CSRF_TOKEN):
        abort(403, description="Missing or stale form token - reload the page and try again.")


def _done(ok: bool, message: str):
    message_id = secrets.token_urlsafe(8)
    with _messages_lock:
        _messages[message_id] = (ok, message)
        while len(_messages) > _MAX_MESSAGES:
            _messages.pop(next(iter(_messages)))
    return redirect(f"/?models_msg={message_id}#models", code=303)


@bp.post("/models/upload")
def upload():
    _check_post()
    file = request.files.get("package")
    if file is None or not file.filename:
        return _done(False, "Choose a model package (.zip) to upload.")
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "package.zip"
        file.save(path)
        try:
            card = _registry().add_package(path, origin=f"upload: {file.filename}")
        except ModelError as error:
            return _done(False, str(error))
    return _done(True, f"Added {card['name']} ({card['id']}).")


@bp.post("/models/download")
def download():
    _check_post()
    url = request.form.get("url", "").strip()
    sha256 = request.form.get("sha256", "").strip()
    suggested = next((m for m in SUGGESTED_MODELS if m["id"] == request.form.get("suggested")), None)
    if suggested:
        # The URL and hash come from config, not the form, so the one-click
        # button can only ever fetch exactly the published package.
        url, sha256 = suggested["url"], suggested["sha256"]
    if not url:
        return _done(False, "Enter the https:// URL of a model package.")
    try:
        card = _registry().add_from_url(url, sha256 or None)
    except ModelError as error:
        return _done(False, str(error))
    return _done(True, f"Downloaded and added {card['name']} ({card['id']}).")


@bp.post("/models/<model_id>/delete")
def delete(model_id: str):
    _check_post()
    try:
        _registry().delete(model_id)
    except ModelError as error:
        return _done(False, str(error))
    return _done(True, f"Deleted {model_id}.")


# --------------------------------------------------------------------- rendering

PORTAL_CSS = """
.models table { width: 100%; border-collapse: collapse; font-size: .95rem; }
.models th, .models td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
.models th { color: var(--muted); font-weight: 500; }
.models details { margin-top: .35rem; }
.models summary { cursor: pointer; color: var(--accent); }
.models .card-body { margin-top: .5rem; }
.models .card-body dl { grid-template-columns: max-content 1fr; }
.models .card-body dd { font-family: inherit; font-size: .9rem; }
.models h3 { font-size: 1.05rem; margin: 1.5rem 0 .5rem; }
.models form { margin: .5rem 0; }
.models input[type=url], .models input[type=text] { width: 100%; padding: .4rem; margin: .2rem 0; font: inherit;
  background: var(--code-bg); color: var(--fg); border: 1px solid var(--line); border-radius: 5px; }
.models button { font: inherit; padding: .35rem .9rem; border-radius: 6px; border: 1px solid var(--accent);
  background: var(--accent); color: var(--bg); cursor: pointer; }
.models button.secondary { background: transparent; color: var(--accent); }
.models .warn { border-left: 3px solid var(--accent); padding: .4rem .8rem; background: var(--code-bg); }
.models .msg { padding: .5rem .8rem; border-radius: 6px; border: 1px solid var(--line); }
.models .msg.ok { border-color: #3c8d4f; }
.models .msg.err { border-color: #c0392b; }
.models .tag { font-size: .75rem; border: 1px solid var(--line); border-radius: 999px; padding: 0 .5em; color: var(--muted); }
"""


def _fmt(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.4g}"
    if value is None or value == "":
        return "-"
    return str(value)


def _card_body(card: dict[str, Any]) -> str:
    e = html.escape
    rows: list[tuple[str, str]] = []

    def add(label: str, value: str) -> None:
        rows.append((label, value))

    provider = card.get("provider") or {}
    provider_html = e(provider.get("name") or "-")
    if provider.get("url", "").startswith(("https://", "http://")):
        provider_html = f'<a href="{e(provider["url"])}" rel="noreferrer">{provider_html}</a>'
    add("Description", e(card.get("description") or "-"))
    add("Provider", provider_html)
    add("Provider notes", e(card.get("notes") or "-"))
    add("Created", e(card.get("created_at") or "-"))
    model_type = card.get("model_type") or {}
    add(
        "Model type",
        "<br>".join(
            e(part)
            for part in (
                f"{model_type.get('predictor', '-')}: {model_type.get('predictor_role', '')}",
                f"{model_type.get('feedback', '-')}: {model_type.get('feedback_role', '')}",
            )
        ),
    )
    definitions = card.get("feature_definitions") or {}
    importances = card.get("feature_importances") or {}
    add(
        "Features",
        "<br>".join(
            f"<code>{e(name)}</code> - {e(definitions.get(name, ''))}"
            + (f" (importance {_fmt(importances[name])})" if name in importances else "")
            for name in card.get("features") or []
        ),
    )
    add("Target", e(card.get("target_definition") or card.get("target") or "-"))
    training = card.get("training") or {}
    add(
        "Training",
        e(
            f"{_fmt(training.get('rows'))} videos from {_fmt(training.get('dataset'))}; "
            f"{_fmt(training.get('train_rows'))} to train, {_fmt(training.get('test_rows'))} held out "
            f"(test size {_fmt(training.get('test_size'))}, seed {_fmt(training.get('random_state'))})."
        ),
    )
    metrics = card.get("metrics") or {}
    add(
        "Held-out accuracy",
        "<br>".join(
            e(f"{name.replace('_', ' ')}: RMSE {_fmt(m.get('rmse'))}, R² {_fmt(m.get('r2'))}")
            for name, m in metrics.items()
        )
        or "-",
    )
    add(
        "Hyperparameters",
        e(
            ", ".join(
                f"{k}={'None' if v is None else _fmt(v)}"
                for k, v in (card.get("hyperparameters") or {}).items()
            )
            or "-"
        ),
    )
    add("Recommendation threshold", e(f"{_fmt(card.get('recommendation_threshold'))} APV points per SD"))
    add(
        "Framework",
        e(", ".join(f"{k} {v}" for k, v in (card.get("framework") or {}).items()) or "-"),
    )
    return "<dl>" + "".join(f"<dt>{label}</dt><dd>{value}</dd>" for label, value in rows) + "</dl>"


def models_card_html() -> str:
    """The models card for the page at /."""
    e = html.escape
    registry = _registry()
    manage = can_manage()
    entries = registry.entries()

    message = ""
    message_id = request.args.get("models_msg")
    if message_id:
        with _messages_lock:
            found = _messages.pop(message_id, None)
        if found:
            ok, text = found
            message = f'<p class="msg {"ok" if ok else "err"}">{e(text)}</p>'

    rows = []
    for entry in entries:
        card = entry["card"] or {}
        tags = [entry["source"]] + (["default"] if entry.get("default") else [])
        status = (
            "usable"
            if entry["compatible"]
            else "cannot be used: " + " ".join(entry["problems"])
        )
        delete = ""
        if manage and entry["source"] == "added":
            delete = (
                f'<form method="post" action="/models/{e(entry["id"])}/delete">'
                f'<input type="hidden" name="csrf" value="{_CSRF_TOKEN}">'
                '<button class="secondary" type="submit">Delete</button></form>'
            )
        origin = (
            f'<dt>Added</dt><dd>{e(_fmt(entry.get("installed_at")))} from {e(_fmt(entry.get("origin")))}'
            f' (SHA-256 {e(_fmt(entry.get("sha256")))})</dd>'
            if entry["source"] == "added"
            else ""
        )
        rows.append(
            "<tr><td>"
            f"<strong>{e(card.get('name') or entry['id'])}</strong> "
            + " ".join(f'<span class="tag">{e(t)}</span>' for t in tags)
            + f"<br><code>{e(entry['id'])}</code> v{e(_fmt(card.get('version')))}"
            f" · {e((card.get('provider') or {}).get('name') or '-')}"
            f" · {len(card.get('features') or [])} features"
            f"<br><span>{e(status)}</span>"
            f'<details><summary>Model card</summary><div class="card-body">'
            f"{_card_body(card) if card else ''}"
            f"{('<dl>' + origin + '</dl>') if origin else ''}</div></details>"
            f"</td><td>{delete}</td></tr>"
        )

    table = (
        "<table><thead><tr><th>Model</th><th></th></tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table>"
    )

    if manage:
        installed = {entry["id"] for entry in entries}
        suggestions = "".join(
            f'<li><form method="post" action="/models/download">'
            f'<input type="hidden" name="csrf" value="{_CSRF_TOKEN}">'
            f'<input type="hidden" name="suggested" value="{e(m["id"])}">'
            f"<strong>{e(m['name'])}</strong> - {e(m['description'])} "
            f'<button type="submit">Download</button></form></li>'
            for m in SUGGESTED_MODELS
            if m["id"] not in installed
        )
        manage_html = f"""
  <h3>Add a model</h3>
  <p class="warn">A model file can run code on this computer when it is loaded.
  Only add models from providers you trust. Published models below are checked
  against their SHA-256 before they are opened.</p>
  {"<p>Published models:</p><ul>" + suggestions + "</ul>" if suggestions else ""}
  <form method="post" action="/models/upload" enctype="multipart/form-data">
    <input type="hidden" name="csrf" value="{_CSRF_TOKEN}">
    <label>Upload a model package (.zip of model.json and model.joblib)<br>
    <input type="file" name="package" accept=".zip" required></label>
    <button type="submit">Upload</button>
  </form>
  <form method="post" action="/models/download">
    <input type="hidden" name="csrf" value="{_CSRF_TOKEN}">
    <label>Or download one from an https:// URL
    <input type="url" name="url" placeholder="https://example.org/model.zip" required></label>
    <label>Expected SHA-256 (optional, recommended)
    <input type="text" name="sha256" pattern="[0-9a-fA-F]{{64}}" placeholder="64 hex characters"></label>
    <button type="submit">Download</button>
  </form>"""
    elif MODEL_MANAGEMENT:
        manage_html = "<p>Models can be added from a browser on this server's own machine.</p>"
    else:
        manage_html = "<p>Adding models is turned off on this server (<code>MODEL_MANAGEMENT=0</code>).</p>"

    return f"""
  <div class="card models" id="models">
    <h2 style="margin-top:0;font-size:1.2rem">Engagement models</h2>
    <p style="margin-top:0">The models the client's <strong>Recommend</strong> step can choose
    between. Open a model card for how it was trained and how well it did.</p>
    {message}
    {table}
    {manage_html}
  </div>"""
