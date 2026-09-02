import sqlite3

from flask import g

from config import DB_PATH
from models import FileExt, SceneStats, Transcript


def _rebuild_if_pre_async_schema(
    conn: sqlite3.Connection, table: str, create_sql: str, data_columns: str
) -> None:
    """A DB created before async generation existed has its data columns
    (e.g. `text`, `duration_secs`) declared NOT NULL, which rejects a
    'processing' row that hasn't computed them yet. SQLite can't relax a
    NOT NULL constraint via ALTER TABLE, so a table missing the `status`
    column gets rebuilt from scratch, with existing rows carried over as
    status='complete'."""
    columns = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
    if "status" in columns:
        return  # freshly created with the current schema, or already migrated

    conn.execute(f"ALTER TABLE {table} RENAME TO {table}_old")
    conn.execute(create_sql)
    conn.execute(
        f"INSERT INTO {table} (file_hash, status, {data_columns}) "
        f"SELECT file_hash, 'complete', {data_columns} FROM {table}_old"
    )
    conn.execute(f"DROP TABLE {table}_old")
    conn.commit()


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS files (
            file_hash   TEXT PRIMARY KEY,
            file_ext    TEXT NOT NULL,
            uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS transcripts (
            file_hash   TEXT PRIMARY KEY REFERENCES files(file_hash),
            status      TEXT NOT NULL DEFAULT 'processing',
            text        TEXT,
            count_chars INTEGER,
            count_words INTEGER,
            error       TEXT
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

    _rebuild_if_pre_async_schema(
        conn,
        table="transcripts",
        create_sql="""
            CREATE TABLE transcripts (
                file_hash   TEXT PRIMARY KEY REFERENCES files(file_hash),
                status      TEXT NOT NULL DEFAULT 'processing',
                text        TEXT,
                count_chars INTEGER,
                count_words INTEGER,
                error       TEXT
            )
        """,
        data_columns="text, count_chars, count_words",
    )
    _rebuild_if_pre_async_schema(
        conn,
        table="scene_stats",
        create_sql="""
            CREATE TABLE scene_stats (
                file_hash     TEXT PRIMARY KEY REFERENCES files(file_hash),
                status        TEXT NOT NULL DEFAULT 'processing',
                duration_secs REAL,
                scenes        REAL,
                error         TEXT
            )
        """,
        data_columns="duration_secs, scenes",
    )

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
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
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
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


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
            "SELECT status, text, count_chars, count_words, error FROM transcripts WHERE file_hash = ?",
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


def complete_transcript(file_hash: str, transcript: Transcript) -> None:
    conn = _connect()
    try:
        conn.execute(
            """
            UPDATE transcripts
            SET status = 'complete', text = ?, count_chars = ?, count_words = ?, error = NULL
            WHERE file_hash = ?
            """,
            (transcript.text, transcript.count_chars, transcript.count_words, file_hash),
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
