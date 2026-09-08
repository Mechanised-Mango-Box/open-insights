"""Who is calling, and what that entitles them to.

The server has always been open by design - it was written to sit on a desk and
be talked to by one person's browser. Putting it on a public address changes what
the existing comments in config.py and app.py describe as a hazard into a live
one: an unauthenticated endpoint that accepts multi-gigabyte bodies and spends
minutes of CPU per request.

Two tiers, because the honest answer to "who is this?" has two useful values:

  private  the operator, holding a key nobody else has. No limits.
  public   a caller holding the key that ships inside a public static site -
           which is to say, anyone. Rate limited and capped.

The public key is not a secret and this module does not pretend otherwise. A key
served in a JavaScript bundle is readable by everyone who loads the page. What it
buys is friction against drive-by scripted abuse, and a handle to rotate when
someone leans on it - not confidentiality.

With neither key configured (the default) every caller is private and none of
this does anything, which is what keeps `py main.py` working with no setup.
"""

from typing import Literal

from config import (
    AUTH_ENABLED,
    PRIVATE_API_KEY,
    PUBLIC_API_KEY,
    PUBLIC_MAX_UPLOAD_BYTES,
    PUBLIC_RATE_LIMIT,
)
from flask import Flask, g, jsonify, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

Tier = Literal["public", "private"]

API_KEY_HEADER = "X-API-Key"

# Created here rather than in app.py so routes.py can decorate individual
# endpoints with tighter limits without importing app.py, which imports it.
# app.py calls init_app().
#
# The default in-memory storage is the right backend rather than a compromise:
# this server is single-process by design (see the -w 1 note in the Dockerfile),
# so there is no second worker for a shared store to synchronise with.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[PUBLIC_RATE_LIMIT],
    # The private tier is exempt from every limit, including the per-endpoint
    # ones in routes.py. getattr rather than g.tier because a limiter check that
    # somehow ran before the tier hook should degrade to "limited", not explode.
    default_limits_exempt_when=lambda: getattr(g, "tier", "public") == "private",
    # Off by default; app.py turns it on only when a key is configured, so the
    # unconfigured local server has no limiter behaviour at all.
    enabled=False,
)


def is_private() -> bool:
    """Whether the current request may skip the public tier's caps.

    Defaults to private for anything that reaches this without having gone
    through the hook below - a CLI, a test, a shell in the container - which is
    the same thing an unconfigured server does for everyone."""
    return getattr(g, "tier", "private") == "private"


def _resolve_tier() -> Tier | None:
    """The tier for this request, or None if the key was absent or wrong."""
    presented = request.headers.get(API_KEY_HEADER, "")
    if not presented:
        return None
    # Compared in this order so that configuring both keys to the same value
    # grants the higher tier rather than the lower.
    if PRIVATE_API_KEY and presented == PRIVATE_API_KEY:
        return "private"
    if PUBLIC_API_KEY and presented == PUBLIC_API_KEY:
        return "public"
    return None


def install(app: Flask) -> None:
    """Registers tier resolution and starts the limiter.

    Must run before limiter.init_app(): both hang off before_request, they fire
    in registration order, and the limiter's exemption check reads the tier this
    one sets."""

    @app.before_request
    def _authenticate():
        if not AUTH_ENABLED:
            g.tier = "private"
            return None

        # A CORS preflight carries no custom headers - that is the whole point of
        # it: the browser is asking whether it may send X-API-Key at all. Reject
        # it and the real request is never attempted, so the client fails with an
        # opaque CORS error rather than the 401 it would have understood.
        if request.method == "OPTIONS":
            return None

        tier = _resolve_tier()
        if tier is None:
            return jsonify({"err": "Missing or invalid API key."}), 401

        g.tier = tier

        # The global MAX_CONTENT_LENGTH stays the private ceiling; the public
        # tier gets a lower one for this request only. Werkzeug enforces it
        # lazily as the stream is read, so setting it here - before any route
        # has touched request.files - still yields a 413 rather than a
        # half-written spool file.
        if tier == "public" and PUBLIC_MAX_UPLOAD_BYTES:
            request.max_content_length = PUBLIC_MAX_UPLOAD_BYTES

        return None

    limiter.enabled = AUTH_ENABLED
    limiter.init_app(app)
