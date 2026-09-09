"""Container liveness probe: is the port answering and is Flask routing?

Deliberately treats 401 as healthy. /status sits behind the API key whenever one
is configured (see auth.py), so a probe that only accepted 2xx would report a
perfectly healthy public deployment as dead. What this checks is that the WSGI
server is up and the blueprint is registered - not that the caller is allowed in.

urllib rather than curl: the slim base image has no curl, and adding one for this
would be a package for a five-line script.
"""

import sys
import urllib.error
import urllib.request

URL = "http://127.0.0.1:5000/status"
TIMEOUT_SECONDS = 5


def main() -> int:
    try:
        urllib.request.urlopen(URL, timeout=TIMEOUT_SECONDS)
    except urllib.error.HTTPError as e:
        # Routed and answered, which is the question being asked.
        return 0 if e.code == 401 else 1
    except Exception:
        # Refused, timed out, or DNS - not up.
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
