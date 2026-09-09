# The API server. Build context is this directory (see .dockerignore) - pointing
# it at the repo root would sweep in data/local, which is GB-scale.
#
#   docker build -t open-insights-server ./server
#
# 3.13 rather than 3.14: the code needs >=3.12 for PEP 695 generics
# (processing.py's `def _submit[T]`), and 3.13 is the newest with a complete set
# of aarch64 wheels across ctranslate2/onnxruntime/av - which is what the
# Oracle Ampere target needs. 3.14 has gaps that force source builds.
FROM python:3.13-slim-bookworm

# No system ffmpeg: faster-whisper reaches it through `av`, which bundles its own
# libs, and opencv-python-headless drops the GUI shared libraries that the
# non-headless wheel would otherwise need here.

ENV PYTHONDONTWRITEBYTECODE=1 \
    # The server reports progress with print() and logs job failures from
    # background threads. Unbuffered, or none of it reaches `docker logs` until
    # the process dies.
    PYTHONUNBUFFERED=1 \
    # Off here, on everywhere else - the one setting in config.py's gating
    # section that a deployment opts out of rather than into. The instructions
    # tell a reader how to point a client at *this* address, which is the right
    # thing to say to someone who just ran the packaged build on their laptop
    # and the wrong thing for a public server to publish at /. Set in the image
    # rather than only in docker-compose.yml so a plain `docker run` gets the
    # deployment's default too. With this off, / is the redirect to /status that
    # it has always been.
    SHOW_INSTRUCTIONS=0

# uid 1000 so a bind-mounted data directory owned by the usual first host user
# is writable without a chown on the host side.
RUN useradd --create-home --uid 1000 app

# Where the CTranslate2 weights live. Read by both config.py and
# scripts/fetch_whisper_model.py, so the build and the runtime cannot disagree
# about the location.
ENV WHISPER_MODEL_DIR=/opt/models
RUN mkdir -p "$WHISPER_MODEL_DIR" && chown app:app "$WHISPER_MODEL_DIR"

WORKDIR /app

# Dependencies first, so editing source does not reinstall them.
COPY --chown=app:app requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

USER app

# Bake the weights into the image. processing.py builds WhisperModel at import
# time with local_files_only=True, so a container whose WHISPER_MODEL_DIR is
# empty does not fail on its first request - it fails to boot at all.
#
# Only the files fetch_whisper_model.py actually needs are copied first (it
# imports config, which imports models and paths). Copying the whole tree here
# instead would make every source edit re-download the weights.
#
# Keep this list in step with config.py's imports: it is the whole of what the
# fetch runs against, so a new one that is missing here fails the build here
# rather than at runtime.
ARG WHISPER_MODEL=tiny.en
ENV WHISPER_MODEL=${WHISPER_MODEL}
COPY --chown=app:app models.py config.py paths.py ./
COPY --chown=app:app scripts/ ./scripts/
RUN python scripts/fetch_whisper_model.py

COPY --chown=app:app . .

EXPOSE 5000

# start-period is generous because boot is not cheap: the weights load before
# Flask ever binds the port. See scripts/healthcheck.py for why 401 counts as
# healthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD ["python", "scripts/healthcheck.py"]

# One worker, deliberately. It is an invariant, not a tuning choice:
#   - processing.py's two ThreadPoolExecutors (SUBMIT) are module-level, so each
#     worker would get its own pair and its own copy of the weights.
#   - start_backfill()'s sweeper thread would run once per worker.
#   - config.py's DB_BUSY_TIMEOUT_MS comment records real "database is locked"
#     failures from SQLite write contention within a *single* process. More
#     writers is the direction that made it worse.
# No --preload for the same reason: the sweeper thread must not be forked.
#
# --timeout 900 because gunicorn's default 30s kills an in-flight multi-GB
# upload, which is a normal request here rather than a hung one.
CMD ["gunicorn", \
     "--worker-class", "gthread", \
     "--workers", "1", \
     "--threads", "8", \
     "--timeout", "900", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-", \
     "--bind", "0.0.0.0:5000", \
     "app:app"]
