import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from flask import g

from config import (
    DB_PATH,
    JOB_LEASE_SECONDS,
    MAX_ATTEMPTS,
    SCENE_STATS_PRODUCER,
    TRANSCRIPT_PRODUCER,
)
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


# ---------------------------------------------------------------------------
# Dataset kinds
# ---------------------------------------------------------------------------
# A result table holds only finished results - a row exists if and only if the
# data does, which is why every value column can be NOT NULL. Lifecycle lives in
# `jobs` instead. Describing each kind as data rather than as its own pair of
# tables-plus-functions is what lets one set of operations serve both, and makes
# a third kind a registration rather than another dozen copied functions.
@dataclass(frozen=True)
class DatasetKind:
    name: str
    table: str
    columns: tuple[str, ...]
    producer: str


TRANSCRIPT = DatasetKind(
    name="transcript",
    table="transcripts",
    columns=("count_chars", "count_words", "segments_json"),
    producer=TRANSCRIPT_PRODUCER,
)

SCENE_STATS = DatasetKind(
    name="scene_stats",
    table="scene_stats",
    columns=("duration_secs", "scenes"),
    producer=SCENE_STATS_PRODUCER,
)

KINDS: dict[str, DatasetKind] = {kind.name: kind for kind in (TRANSCRIPT, SCENE_STATS)}


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
_SCHEMA = """
    CREATE TABLE IF NOT EXISTS files (
        file_hash   TEXT PRIMARY KEY,
        file_ext    TEXT NOT NULL,
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Pure cache. No status column: presence IS completion, which is what makes
    -- every value column NOT NULL and a half-written result unrepresentable.
    CREATE TABLE IF NOT EXISTS transcripts (
        file_hash     TEXT PRIMARY KEY REFERENCES files(file_hash),
        count_chars   INTEGER NOT NULL,
        count_words   INTEGER NOT NULL,
        segments_json TEXT    NOT NULL,
        producer      TEXT    NOT NULL,
        produced_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scene_stats (
        file_hash     TEXT PRIMARY KEY REFERENCES files(file_hash),
        duration_secs REAL NOT NULL,
        scenes        REAL NOT NULL,
        producer      TEXT NOT NULL,
        produced_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Lifecycle, one row per (kind, file_hash). Terminal success is the absence
    -- of a job plus the presence of a result, so there is no 'complete' here.
    CREATE TABLE IF NOT EXISTS jobs (
        kind             TEXT NOT NULL CHECK (kind IN ('transcript', 'scene_stats')),
        file_hash        TEXT NOT NULL REFERENCES files(file_hash),
        status           TEXT NOT NULL CHECK (status IN ('queued', 'running', 'failed')),
        attempts         INTEGER NOT NULL DEFAULT 0,
        error            TEXT,
        lease_expires_at TEXT,
        updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (kind, file_hash),
        -- A running job always holds a lease; a queued or failed one never does.
        CHECK ((status = 'running') = (lease_expires_at IS NOT NULL))
    );
"""


def _requeue(
    conn: sqlite3.Connection, where: str, params: tuple[Any, ...], reason: str
) -> int:
    """Hands running jobs matching `where` back to the queue. Shared by the
    startup sweep and the lease sweep so the two cannot disagree about what
    reclaiming a job means."""
    cursor = conn.execute(
        "UPDATE jobs SET status = 'queued', lease_expires_at = NULL, "
        "    error = ?, updated_at = datetime('now') "
        f"WHERE {where}",
        (reason, *params),
    )
    return cursor.rowcount


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _migrate_from_status_rows(conn: sqlite3.Connection) -> None:
    """Moves pre-jobs data across. The result tables used to carry a status
    column and hold rows for work that had not finished; now they hold only
    finished results. Completed rows become results, everything else becomes a
    queued job - so no finished transcript is lost and nothing in flight is
    forgotten."""
    if "status" not in _table_columns(conn, "transcripts"):
        return

    conn.executescript("""
        ALTER TABLE transcripts RENAME TO _old_transcripts;
        ALTER TABLE scene_stats RENAME TO _old_scene_stats;
    """)
    conn.executescript(_SCHEMA)

    # `engine` was itself a late addition, so a database can reach here from
    # either side of that change: one that has the column carries a real
    # producer per row, one that predates it has no column to read at all.
    # Selecting a literal in the second case is what lets both migrate.
    producer_expr = (
        "COALESCE(engine, 'legacy/unknown')"
        if "engine" in _table_columns(conn, "_old_transcripts")
        else "'legacy/unknown'"
    )
    # Rows stamped legacy read as stale against the current producer and get
    # recomputed, rather than being trusted as something they may not be.
    conn.execute(f"""
        INSERT INTO transcripts
            (file_hash, count_chars, count_words, segments_json, producer)
        SELECT file_hash, count_chars, count_words, segments_json, {producer_expr}
        FROM _old_transcripts
        WHERE status = 'complete'
          AND count_chars IS NOT NULL
          AND count_words IS NOT NULL
          AND segments_json IS NOT NULL
    """)
    # scene_stats never had a producer column, so nothing records how these were
    # computed. Marked legacy so they recompute once under a known threshold.
    conn.execute("""
        INSERT INTO scene_stats (file_hash, duration_secs, scenes, producer)
        SELECT file_hash, duration_secs, scenes, 'legacy/unknown'
        FROM _old_scene_stats
        WHERE status = 'complete'
          AND duration_secs IS NOT NULL
          AND scenes IS NOT NULL
    """)

    # Anything not complete was either running when a process died or had
    # failed. Both become queued: a lost job was never the video's fault, and a
    # failed one is worth an attempt under the current engine.
    for kind, table in (("transcript", "_old_transcripts"), ("scene_stats", "_old_scene_stats")):
        conn.execute(
            "INSERT OR IGNORE INTO jobs (kind, file_hash, status) "
            f"SELECT ?, file_hash, 'queued' FROM {table} WHERE status != 'complete'",
            (kind,),
        )

    conn.executescript("""
        DROP TABLE _old_transcripts;
        DROP TABLE _old_scene_stats;
    """)


def init_db() -> None:
    conn = _configure(sqlite3.connect(DB_PATH))
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(_SCHEMA)
    conn.commit()

    _migrate_from_status_rows(conn)
    conn.commit()

    # A running job's worker lived in the previous process's in-memory executor,
    # which no restart survives. Requeue rather than fail: nothing is wrong with
    # the video, so making someone press retry for it is just noise.
    #
    # attempts is deliberately NOT incremented here - claim() counts a run when
    # it starts one, and counting the requeue too would charge a single attempt
    # twice, exhausting the budget in half the restarts it should take.
    _requeue(
        conn,
        "status = 'running' AND attempts < ?",
        (MAX_ATTEMPTS,),
        "Worker lost (server restart)",
    )
    # A video that kills the process takes the whole server down with it on every
    # restart, so past the cap it has to stop being retried automatically - that
    # is the crash loop the budget exists to break. It stays diagnosable and an
    # explicit retry can still force it.
    conn.execute(
        "UPDATE jobs SET status = 'failed', lease_expires_at = NULL, "
        "    error = 'Worker lost repeatedly; giving up after '||attempts||' attempts', "
        "    updated_at = datetime('now') "
        "WHERE status = 'running' AND attempts >= ?",
        (MAX_ATTEMPTS,),
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


# Job and result rows are read/written from both request threads (via Flask's
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


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
def get_result(kind: DatasetKind, file_hash: str) -> sqlite3.Row | None:
    """The cached result for this kind, whatever produced it. Callers asking
    'is this usable now' want dataset_state(), which also checks the producer."""
    conn = _connect()
    try:
        columns = ", ".join((*kind.columns, "producer", "produced_at"))
        return conn.execute(
            f"SELECT {columns} FROM {kind.table} WHERE file_hash = ?", (file_hash,)
        ).fetchone()
    finally:
        conn.close()


def put_result(kind: DatasetKind, file_hash: str, values: dict[str, Any]) -> None:
    """Stores a finished result and clears the job that produced it. Success is
    represented by a result row existing and no job remaining, so both halves go
    in one transaction - a crash between them would otherwise leave a finished
    result still looking like work in progress."""
    columns = (*kind.columns, "producer")
    placeholders = ", ".join("?" for _ in (*columns, "file_hash"))
    conn = _connect()
    try:
        with conn:
            conn.execute(
                f"INSERT OR REPLACE INTO {kind.table} "
                f"({', '.join(columns)}, file_hash, produced_at) "
                f"VALUES ({placeholders}, datetime('now'))",
                (*(values[column] for column in kind.columns), kind.producer, file_hash),
            )
            conn.execute(
                "DELETE FROM jobs WHERE kind = ? AND file_hash = ?", (kind.name, file_hash)
            )
    finally:
        conn.close()


def transcript_values(transcript: Transcript) -> dict[str, Any]:
    return {
        "count_chars": transcript.count_chars,
        "count_words": transcript.count_words,
        "segments_json": json.dumps(
            [{"start": s.start, "end": s.end, "text": s.text} for s in transcript.segments]
        ),
    }


def scene_stats_values(scene_stats: SceneStats) -> dict[str, Any]:
    return {"duration_secs": scene_stats.duration_secs, "scenes": scene_stats.scenes}


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
def enqueue(kind: DatasetKind, file_hash: str, *, force: bool = False) -> bool:
    """Queues work for this kind. Returns True iff this call queued it, so the
    caller knows whether it owns submitting the job to the executor.

    Idempotent: a job already queued or running is left alone. A failed job is
    requeued only while it has attempts left, or when `force` says this is an
    explicit retry - which also resets the attempt count."""
    conn = _connect()
    try:
        with conn:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO jobs (kind, file_hash, status) VALUES (?, ?, 'queued')",
                (kind.name, file_hash),
            )
            if cursor.rowcount == 1:
                return True

            # A row already existed. Only a failed one is eligible to restart.
            if force:
                cursor = conn.execute(
                    "UPDATE jobs SET status = 'queued', error = NULL, attempts = 0, "
                    "    lease_expires_at = NULL, updated_at = datetime('now') "
                    "WHERE kind = ? AND file_hash = ? AND status = 'failed'",
                    (kind.name, file_hash),
                )
            else:
                cursor = conn.execute(
                    "UPDATE jobs SET status = 'queued', error = NULL, "
                    "    lease_expires_at = NULL, updated_at = datetime('now') "
                    "WHERE kind = ? AND file_hash = ? AND status = 'failed' AND attempts < ?",
                    (kind.name, file_hash, MAX_ATTEMPTS),
                )
            return cursor.rowcount == 1
    finally:
        conn.close()


def claim(kind: DatasetKind, file_hash: str) -> bool:
    """Takes ownership of a queued job, holding a lease on it. Returns True iff
    this call claimed it - the guard on status is what makes two workers racing
    for the same job safe, since only one UPDATE can match."""
    conn = _connect()
    try:
        with conn:
            cursor = conn.execute(
                "UPDATE jobs SET status = 'running', attempts = attempts + 1, "
                f"    lease_expires_at = datetime('now', '+{JOB_LEASE_SECONDS} seconds'), "
                "    updated_at = datetime('now') "
                "WHERE kind = ? AND file_hash = ? AND status = 'queued'",
                (kind.name, file_hash),
            )
            return cursor.rowcount == 1
    finally:
        conn.close()


def fail(kind: DatasetKind, file_hash: str, error: str) -> None:
    conn = _connect()
    try:
        with conn:
            conn.execute(
                "UPDATE jobs SET status = 'failed', error = ?, lease_expires_at = NULL, "
                "    updated_at = datetime('now') "
                "WHERE kind = ? AND file_hash = ?",
                (error, kind.name, file_hash),
            )
    finally:
        conn.close()


def requeue_expired() -> int:
    """Requeues running jobs whose lease has passed. Covers a worker killed
    without a restart, and is what would let a second replica pick up work
    abandoned by a first. Returns how many were reclaimed."""
    conn = _connect()
    try:
        with conn:
            reclaimed = _requeue(
                conn,
                "status = 'running' AND lease_expires_at < datetime('now') AND attempts < ?",
                (MAX_ATTEMPTS,),
                "Worker lost (lease expired)",
            )
            conn.execute(
                "UPDATE jobs SET status = 'failed', lease_expires_at = NULL, "
                "    error = 'Worker lost repeatedly; giving up after '||attempts||' attempts', "
                "    updated_at = datetime('now') "
                "WHERE status = 'running' AND lease_expires_at < datetime('now') "
                "  AND attempts >= ?",
                (MAX_ATTEMPTS,),
            )
            return reclaimed
    finally:
        conn.close()


def queued_jobs() -> list[sqlite3.Row]:
    """Every job waiting for a worker, joined to the file extension needed to
    locate its video. Read at startup to re-submit work whose executor died with
    a previous process - init_db requeues such jobs, but requeueing alone leaves
    them correctly marked and permanently unattended."""
    conn = _connect()
    try:
        return conn.execute(
            "SELECT j.kind, j.file_hash, f.file_ext "
            "FROM jobs j JOIN files f ON f.file_hash = j.file_hash "
            "WHERE j.status = 'queued' ORDER BY j.updated_at"
        ).fetchall()
    finally:
        conn.close()


def get_job(kind: DatasetKind, file_hash: str) -> sqlite3.Row | None:
    conn = _connect()
    try:
        return conn.execute(
            "SELECT status, attempts, error, lease_expires_at, updated_at "
            "FROM jobs WHERE kind = ? AND file_hash = ?",
            (kind.name, file_hash),
        ).fetchone()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Derived state
# ---------------------------------------------------------------------------
def dataset_state(kind: DatasetKind, file_hash: str) -> dict[str, Any]:
    """The single definition of what state a dataset is in, derived from the
    result and job rows rather than stored anywhere. Both routes - and the
    client through them - read this one answer, which is what keeps the
    vocabulary from drifting apart between layers again.

    A result whose producer no longer matches reads as absent: it was made by a
    different model or a different parameter, so it is not the thing being asked
    for, and saying 'ready' about it would be a lie."""
    result = get_result(kind, file_hash)
    job = get_job(kind, file_hash)

    if result is not None and result["producer"] == kind.producer:
        state: dict[str, Any] = {
            "state": "ready",
            "producer": result["producer"],
            "produced_at": result["produced_at"],
        }
        state.update({column: result[column] for column in kind.columns})
        # A regeneration requested over a result that is already good keeps
        # serving that result - it is still valid until the new one lands - but
        # says so, otherwise the work would be invisible to anyone watching.
        if job is not None and job["status"] in ("queued", "running"):
            state["refreshing"] = job["status"]
        elif job is not None and job["status"] == "failed":
            # The data below predates a refresh that did not work. Still usable,
            # still exports, but it is not what this producer would make now.
            state["refresh_error"] = job["error"] or "Unknown error"
        return state

    if job is None:
        return {"state": "absent"}
    if job["status"] == "failed":
        return {
            "state": "failed",
            "error": job["error"] or "Unknown error",
            "attempts": job["attempts"],
        }
    return {"state": job["status"], "attempts": job["attempts"]}
