import os

from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from config import MAX_UPLOAD_BYTES, UPLOAD_FOLDER
from db import close_db, init_db
from processing import resubmit_orphaned_jobs, start_backfill
from routes import bp

app = Flask(__name__)

# Allow angular - TBD
_ALLOWED_ORIGINS = [
    "http://localhost:4200",
    "http://localhost",
    "https://mechanised-mango-box.github.io",
]

# /status is listed alongside /api/* rather than left out of the CORS config: the
# client's Settings view fetches it to report queue depth and worker load, and a
# browser refuses to read a cross-origin response that carries no
# Access-Control-Allow-Origin. Named once above so the two entries cannot drift.
CORS(
    app,
    resources={
        r"/api/*": {"origins": _ALLOWED_ORIGINS},
        r"/status": {"origins": _ALLOWED_ORIGINS},
    },
)

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
# Werkzeug turns an over-size body into a 413 before the route reads it. Left
# unset it spools a body of any size to disk, which - with no auth and a public
# origin in the CORS list above - is one request away from filling the volume.
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


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

app.teardown_appcontext(close_db)

app.register_blueprint(bp)
