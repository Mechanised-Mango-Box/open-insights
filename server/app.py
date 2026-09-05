import os

from flask import Flask
from flask_cors import CORS

from config import UPLOAD_FOLDER
from db import close_db, init_db
from processing import resume_queued_jobs
from routes import bp

app = Flask(__name__)

# Allow angular - TBD
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "http://localhost:4200",
                "http://localhost",
                "https://mechanised-mango-box.github.io",
            ]
        }
    },
)

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

init_db()

# init_db has just requeued whatever the previous process was running. The job
# rows outlive the process but its executor does not, so without handing them
# back to a worker here they would sit queued forever - GET is read-only by
# design and nothing else would ever pick them up.
print(f"Resumed {resume_queued_jobs()} queued job(s)")

app.teardown_appcontext(close_db)

app.register_blueprint(bp)
