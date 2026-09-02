import os

from flask import Flask
from flask_cors import CORS

from config import UPLOAD_FOLDER
from db import close_db, init_db
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

app.teardown_appcontext(close_db)

app.register_blueprint(bp)
