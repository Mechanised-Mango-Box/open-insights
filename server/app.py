import os
from pathlib import Path

import auth
from config import ALLOWED_ORIGINS, DB_PATH, MAX_UPLOAD_BYTES, UPLOAD_FOLDER
from db import close_db, init_db
from flask import Flask, jsonify
from flask_cors import CORS
from processing import resubmit_orphaned_jobs, start_backfill, start_upload_reaper
from routes import bp
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)

# Behind Caddy in the deployed setup, so the peer address on every request is the
# proxy's. Without this the whole public tier shares one rate-limit bucket keyed
# to that single address - one caller's burst would 429 everybody, and one
# abuser would be indistinguishable from the entire internet.
#
# Trusting exactly one hop, because exactly one is in front of it. Trusting more
# would let a caller forge the header and pick their own bucket.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

# /status is listed alongside /api/* rather than left out of the CORS config: the
# client's Settings view fetches it to report queue depth and worker load, and a
# browser refuses to read a cross-origin response that carries no
# Access-Control-Allow-Origin. Named once in config so the two entries cannot drift.
#
# allow_headers is explicit because of X-API-Key: flask-cors' default reflects
# only the simple headers, so the preflight would answer without it and the
# browser would refuse to send the key - failing as an opaque CORS error rather
# than the 401 it would have been.
CORS(
    app,
    resources={
        r"/api/*": {"origins": ALLOWED_ORIGINS},
        r"/status": {"origins": ALLOWED_ORIGINS},
    },
    allow_headers=["Content-Type", auth.API_KEY_HEADER],
)

# Before the blueprint and before anything else that hangs off before_request:
# tier resolution has to have run by the time the rate limiter checks whether
# this caller is exempt, and hooks fire in registration order.
auth.install(app)

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
# Werkzeug turns an over-size body into a 413 before the route reads it. Left
# unset it spools a body of any size to disk, which - with no auth and a public
# origin in the CORS list above - is one request away from filling the volume.
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
# The database's directory too, which nothing has ever created. In a clone that
# went unnoticed - data/local exists because the repository ships it - but a
# packaged server started in an empty folder has no such luck, and sqlite3 does
# not create missing parents: it raises "unable to open database file" from
# init_db() below, before the port is ever bound.
os.makedirs(Path(DB_PATH).parent, exist_ok=True)


# The client parses JSON and only JSON, so an error that renders as werkzeug's
# HTML page reaches it as a parse failure with the real status lost. routes.py
# already went to the trouble of hand-building a JSON 404; these two make it the
# rule for every error rather than one endpoint's special case.
@app.errorhandler(HTTPException)
def _json_http_error(e: HTTPException):
    # _not_found() attaches a response of its own - honour it rather than
    # rebuilding it and dropping whatever it chose to say.
    if e.response is not None:
        return e.get_response()
    return jsonify({"err": e.description}), e.code


@app.errorhandler(Exception)
def _json_error(e: Exception):
    # The description of an unexpected failure is for the log, not the wire.
    app.logger.exception("Unhandled error")
    return jsonify({"err": "Internal server error"}), 500


init_db()

# init_db has just requeued whatever the previous process was running. The job
# rows outlive the process but its executor does not, so without handing them
# back to a worker here they would sit queued forever - GET is read-only by
# design and nothing else would ever pick them up.
print(f"Resumed {resubmit_orphaned_jobs()} queued job(s)")

# From here a background thread keeps doing that, and additionally starts on any
# uploaded video that has no dataset at all whenever a kind has nothing else to
# do - so work no longer waits on someone being there to ask for it.
start_backfill()

# Independent of the sweeper above and of its flag. A public deployment wants
# backfill off (it starts work nobody asked for) and reaping on, so the two
# cannot share a thread or a switch. No-op unless UPLOAD_DIR_MAX_BYTES is set.
start_upload_reaper()

app.teardown_appcontext(close_db)

app.register_blueprint(bp)
