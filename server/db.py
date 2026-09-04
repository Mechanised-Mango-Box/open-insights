import json
import sqlite3

from flask import g

from config import DB_PATH, TRANSCRIPT_ENGINE
from models import FileExt, SceneStats, Transcript


# Transcript/scene_stats jobs write from executor threads while requests write
# from the request thread, so contention is routine rather than exceptional. Two
# settings make it survivable and both are needed:
#   - WAL lets readers and writers proceed concurrently. The default rollback
#     journal locks the whole file for the duration of any write, so a background
#     job committing a transcript blocks an upload's INSERT outright.
#   - busy_timeout makes a blocked statement wait for the lock instead of giving
#     up. SQLite defaults it to 0 - fail immediately - which is what surfaced as
#     "database is locked" when an upload landed mid-transcription.
# busy_timeout is per-connection and has to be set on every one; journal_mode is
# a persistent property of the file and only needs setting once, at startup.
_BUSY_TIMEOUT_MS = 5000


def _configure(conn: sqlite3.Connection) -> sqlite3.Connection:
    conn.execute(f"PRAGMA busy_timeout = {_BUSY_TIMEOUT_MS}")
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = _configure(sqlite3.connect(DB_PATH))
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS files (
            file_hash   TEXT PRIMARY KEY,
            file_ext    TEXT NOT NULL,
            uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS transcripts (
            file_hash     TEXT PRIMARY KEY REFERENCES files(file_hash),
            status        TEXT NOT NULL DEFAULT 'processing',
            count_chars   INTEGER,
            count_words   INTEGER,
            segments_json TEXT,
            engine        TEXT,
            error         TEXT
        );
        CREATE TABLE IF NOT EXISTS scene_stats (
            file_hash     TEXT PRIMARY KEY REFERENCES files(file_hash),
            status        TEXT NOT NULL DEFAULT 'processing',
            duration_secs REAL,
            scenes        REAL,
            error         TEXT
        );
    """)
    conn.commit()

    # CREATE TABLE IF NOT EXISTS is a no-op on a database that already has the
    # table, so an existing one never gains the column that way - it needs an
    # explicit ALTER, guarded because sqlite has no ADD COLUMN IF NOT EXISTS.
    # Rows predating this read back as engine NULL, which counts as stale and
    # gets them re-transcribed on next request.
    columns = {row[1] for row in conn.execute("PRAGMA table_info(transcripts)")}
    if "engine" not in columns:
        conn.execute("ALTER TABLE transcripts ADD COLUMN engine TEXT")
        conn.commit()

    # Anything still 'processing' at startup belonged to a job in a previous
    # process's in-memory ThreadPoolExecutor, which doesn't survive a restart -
    # without this it would stay stuck "processing" forever.
    conn.execute(
        "UPDATE transcripts SET status = 'failed', error = 'Interrupted by server restart' "
        "WHERE status = 'processing'"
    )
    conn.execute(
        "UPDATE scene_stats SET status = 'failed', error = 'Interrupted by server restart' "
        "WHERE status = 'processing'"
    )
    conn.commit()
    conn.close()


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = _configure(sqlite3.connect(DB_PATH))
    return g.db


def close_db(exception: BaseException | None = None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


# Dataset status rows are read/written from both request threads (via Flask's
# request-scoped get_db()/g) and background executor threads, which have no
# Flask app context. Rather than special-case which thread is calling, every
# function below opens and closes its own short-lived connection.
def _connect() -> sqlite3.Connection:
    return _configure(sqlite3.connect(DB_PATH))


def insert_file(file_hash: str, file_ext: FileExt) -> None:
    db = get_db()
    db.execute(
        "INSERT OR IGNORE INTO files (file_hash, file_ext) VALUES (?, ?)",
        (file_hash, file_ext),
    )
    db.commit()


def get_file_ext(file_hash: str) -> str | None:
    db = get_db()
    row = db.execute(
        "SELECT file_ext FROM files WHERE file_hash = ?", (file_hash,)
    ).fetchone()
    return row["file_ext"] if row is not None else None


def get_transcript_row(file_hash: str) -> sqlite3.Row | None:
    conn = _connect()
    try:
        return conn.execute(
            "SELECT status, count_chars, count_words, segments_json, engine, error "
            "FROM transcripts WHERE file_hash = ?",
            (file_hash,),
        ).fetchone()
    finally:
        conn.close()


def start_transcript_job(file_hash: str) -> bool:
    """Claims the transcript job for file_hash. Returns True iff this call
    claimed it (i.e. no other request already started or finished one)."""
    conn = _connect()
    try:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO transcripts (file_hash, status) VALUES (?, 'processing')",
            (file_hash,),
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def retry_transcript_job(file_hash: str) -> bool:
    """Reclaims a failed transcript job for retry. Returns True iff this call
    claimed it (i.e. no concurrent request already reclaimed it first)."""
    conn = _connect()
    try:
        cursor = conn.execute(
            "UPDATE transcripts SET status = 'processing', error = NULL "
            "WHERE file_hash = ? AND status = 'failed'",
            (file_hash,),
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def invalidate_transcript_job(file_hash: str) -> bool:
    """Reclaims a transcript cached by a different engine so it can be redone.
    Returns True iff this call claimed it (i.e. no concurrent request already
    reclaimed it first). Guarded on status so it can never restart a job that is
    already running."""
    conn = _connect()
    try:
        cursor = conn.execute(
            "UPDATE transcripts "
            "SET status = 'processing', count_chars = NULL, count_words = NULL, "
            "    segments_json = NULL, error = NULL "
            "WHERE file_hash = ? AND status != 'processing'",
            (file_hash,),
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def complete_transcript(file_hash: str, transcript: Transcript) -> None:
    segments_json = json.dumps(
        [{"start": s.start, "end": s.end, "text": s.text} for s in transcript.segments]
    )
    conn = _connect()
    try:
        conn.execute(
            """
            UPDATE transcripts
            SET status = 'complete', count_chars = ?, count_words = ?,
                segments_json = ?, engine = ?, error = NULL
            WHERE file_hash = ?
            """,
            (
                transcript.count_chars,
                transcript.count_words,
                segments_json,
                TRANSCRIPT_ENGINE,
                file_hash,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def fail_transcript(file_hash: str, error: str) -> None:
    conn = _connect()
    try:
        conn.execute(
            "UPDATE transcripts SET status = 'failed', error = ? WHERE file_hash = ?",
            (error, file_hash),
        )
        conn.commit()
    finally:
        conn.close()


def get_scene_stats_row(file_hash: str) -> sqlite3.Row | None:
    conn = _connect()
    try:
        return conn.execute(
            "SELECT status, duration_secs, scenes, error FROM scene_stats WHERE file_hash = ?",
            (file_hash,),
        ).fetchone()
    finally:
        conn.close()


def start_scene_stats_job(file_hash: str) -> bool:
    """Claims the scene_stats job for file_hash. Returns True iff this call
    claimed it (i.e. no other request already started or finished one)."""
    conn = _connect()
    try:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO scene_stats (file_hash, status) VALUES (?, 'processing')",
            (file_hash,),
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def retry_scene_stats_job(file_hash: str) -> bool:
    """Reclaims a failed scene_stats job for retry. Returns True iff this call
    claimed it (i.e. no concurrent request already reclaimed it first)."""
    conn = _connect()
    try:
        cursor = conn.execute(
            "UPDATE scene_stats SET status = 'processing', error = NULL "
            "WHERE file_hash = ? AND status = 'failed'",
            (file_hash,),
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def complete_scene_stats(file_hash: str, scene_stats: SceneStats) -> None:
    conn = _connect()
    try:
        conn.execute(
            """
            UPDATE scene_stats
            SET status = 'complete', duration_secs = ?, scenes = ?, error = NULL
            WHERE file_hash = ?
            """,
            (scene_stats.duration_secs, scene_stats.scenes, file_hash),
        )
        conn.commit()
    finally:
        conn.close()


def fail_scene_stats(file_hash: str, error: str) -> None:
    conn = _connect()
    try:
        conn.execute(
            "UPDATE scene_stats SET status = 'failed', error = ? WHERE file_hash = ?",
            (error, file_hash),
        )
        conn.commit()
    finally:
        conn.close()
