from app import app
from config import SERVER_HOST, SERVER_PORT, SHOW_INSTRUCTIONS
from instructions import banner_text

if __name__ == "__main__":
    # After `from app import app`, so this prints when the server is actually
    # ready rather than in front of the model load it would otherwise be
    # promising. Not in app.py, which gunicorn imports too - a deployment has
    # its own front door and does not want setup instructions in its logs.
    if SHOW_INSTRUCTIONS:
        print(banner_text())
    app.run(host=SERVER_HOST, port=SERVER_PORT, threaded=True)
