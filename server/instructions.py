"""How to point a client at this server, said twice.

A REST API on localhost is not self-explanatory. Someone who has just run the
portable build has a process printing nothing in particular and a browser
showing `{"status": "ok"}`, and nothing anywhere tells them the missing step is
pasting a URL into another site's settings page.

Two surfaces because they catch different people: the console banner reaches
whoever started it, and the page at / reaches whoever opened the address to see
what was listening. One module because they say the same thing, and two copies
of the same setup instructions drift the first time a default changes.

Everything here is derived from live config rather than written down. A server
whose ALLOWED_ORIGINS has been narrowed should say so instead of confidently
naming a client it will refuse.

Nothing here renders a key. AUTH_ENABLED is reported, PUBLIC_API_KEY and
PRIVATE_API_KEY are not read at all - the page is served before the key check
(see auth.py) precisely because it has nothing worth gating.
"""

import html
from urllib.parse import urlsplit

from config import (
    ALLOWED_ORIGINS,
    AUTH_ENABLED,
    DB_PATH,
    SERVER_HOST,
    SERVER_PORT,
    UPLOAD_FOLDER,
    WHISPER_MODEL,
)

# Hosts that a browser cannot usefully be sent to. A server bound to 0.0.0.0 is
# reachable at every address the machine has, and "http://0.0.0.0:5000" is none
# of them - it is a bind wildcard that some browsers refuse outright.
_WILDCARD_HOSTS = {"0.0.0.0", "::", "[::]", ""}


def local_url() -> str:
    """The address to tell someone sitting at this machine to open."""
    host = "localhost" if SERVER_HOST in _WILDCARD_HOSTS else SERVER_HOST
    # An IPv6 literal needs brackets in a URL; a hostname must not have them.
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    return f"http://{host}:{SERVER_PORT}"


def client_origin() -> str | None:
    """The origin to send someone to for the client, or None if we can't say.

    The first allowed origin that isn't loopback. Loopback entries are the
    developer's own `ng serve`, which is not what a person running the packaged
    server is going to be pointed at, and 'open http://localhost:4200' is bad
    advice to give someone who has no checkout.
    """
    for origin in ALLOWED_ORIGINS:
        hostname = urlsplit(origin).hostname or ""
        if hostname not in ("localhost", "127.0.0.1", "::1"):
            return origin
    return None


def _key_line() -> str:
    return (
        "This server requires an API key. Paste the key you configured into the "
        "client's settings alongside the URL."
        if AUTH_ENABLED
        else "Leave the API key field blank - this server does not require one."
    )


def banner_text() -> str:
    """The block printed to the console once the server is ready to serve."""
    server_url = local_url()
    client = client_origin()

    if client:
        steps = [
            f"1. Open  {client}",
            "2. Go to Settings and set the server URL to:",
            f"       {server_url}",
            f"3. {_key_line()}",
        ]
    else:
        # Every allowed origin is loopback, so the client is being served
        # locally too and we have no address worth naming.
        steps = [
            "1. Open your Open Insights client.",
            "2. Go to Settings and set the server URL to:",
            f"       {server_url}",
            f"3. {_key_line()}",
            "",
            "   Allowed origins: " + (", ".join(ALLOWED_ORIGINS) or "(none)"),
        ]

    body = "\n".join(
        [
            "",
            "  " + "-" * 68,
            "  Open Insights server is running.",
            "",
            *(f"  {line}" for line in steps),
            "",
            f"  Instructions and details:  {server_url}",
            f"  Model:  {WHISPER_MODEL}",
            f"  Data:   {DB_PATH}",
            "",
            "  Press Ctrl-C to stop.",
            "  " + "-" * 68,
            "",
        ]
    )
    return body


# Inline, because the entire point of the packaged build is that it works with
# no network. A stylesheet or font from a CDN would leave this page unstyled on
# exactly the offline machine it exists to serve.
_PAGE_CSS = """
:root {
  color-scheme: light dark;
  --bg: #fbfbfa; --fg: #1a1a19; --muted: #5f5f5c;
  --card: #ffffff; --line: #e4e4e1; --accent: #b4551f; --code-bg: #f2f2ef;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #191918; --fg: #eeeeec; --muted: #a1a19d;
    --card: #212120; --line: #333331; --accent: #e08c56; --code-bg: #2a2a28;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2.5rem 1.25rem; background: var(--bg); color: var(--fg);
  font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 46rem; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
.lede { color: var(--muted); margin: 0 0 2rem; }
.card {
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
}
ol { margin: 0; padding-left: 1.35rem; }
li { margin-bottom: 1rem; }
li:last-child { margin-bottom: 0; }
code, .url {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .95em; background: var(--code-bg); border: 1px solid var(--line);
  border-radius: 5px; padding: .15em .4em;
}
.url {
  display: inline-block; margin-top: .4rem; padding: .5em .7em;
  font-size: 1rem; color: var(--accent); user-select: all;
}
a { color: var(--accent); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1.25rem; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
     font-size: .9rem; overflow-wrap: anywhere; }
footer { color: var(--muted); font-size: .875rem; margin-top: 2rem; }
"""


def page_html(server_url: str) -> str:
    """The page served at /.

    Takes the URL rather than computing one, because the request knows something
    this process does not: which of its addresses the user actually reached it
    on. Echoing that back means the copyable URL is right whether they came in
    over loopback, a LAN address, or a tunnel.
    """
    server_url = server_url.rstrip("/")
    client = client_origin()
    e = html.escape

    if client:
        first_step = (
            f'Open <a href="{e(client)}" rel="noreferrer">{e(client)}</a> '
            "in this browser."
        )
    else:
        first_step = "Open your Open Insights client."

    origins = (
        "".join(f"<li><code>{e(origin)}</code></li>" for origin in ALLOWED_ORIGINS)
        or "<li>(none - no browser client can reach this server)</li>"
    )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Insights server</title>
<style>{_PAGE_CSS}</style>
</head>
<body>
<main>
  <h1>Open Insights server</h1>
  <p class="lede">This is the analysis API, not the app. Point a client at it:</p>

  <div class="card">
    <ol>
      <li>{first_step}</li>
      <li>
        Go to <strong>Settings</strong> and set the server URL to:
        <br><span class="url">{e(server_url)}</span>
      </li>
      <li>{e(_key_line())}</li>
    </ol>
  </div>

  <div class="card">
    <dl>
      <dt>Model</dt><dd>{e(WHISPER_MODEL)}</dd>
      <dt>Database</dt><dd>{e(str(DB_PATH))}</dd>
      <dt>Uploads</dt><dd>{e(str(UPLOAD_FOLDER))}</dd>
      <dt>API key</dt><dd>{"required" if AUTH_ENABLED else "not required"}</dd>
    </dl>
  </div>

  <div class="card">
    <p style="margin-top:0">
      A browser can only talk to this server from one of these origins:
    </p>
    <ul>{origins}</ul>
    <p style="margin-bottom:0">
      Serving the client from anywhere else? Add it to <code>ALLOWED_ORIGINS</code>
      and restart.
    </p>
  </div>

  <footer>
    Live queue and worker status: <a href="/status">/status</a>.
    Hide this page with <code>SHOW_INSTRUCTIONS=0</code>.
  </footer>
</main>
</body>
</html>
"""
