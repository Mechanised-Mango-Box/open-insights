"""Check on-screen text sampling and the jobs-table migration that admits it.

The OCR model is replaced by a stand-in that answers from a frame's brightness,
so these run without RapidOCR installed and each expected number can be worked
out by hand. Run from the repository root:

    python -m unittest server.tests.test_text_stats
"""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

# Add server/ to Python's search path so its top-level modules are found when
# this file is run directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import KINDS, _migrate_jobs_kinds
from text_stats import OcrLine, calculate_text_stats, count_words

WIDTH, HEIGHT, FPS = 64, 48, 10


def box(fraction):
    """A box covering `fraction` of the frame, anchored at the top-left."""
    side_w, side_h = WIDTH * fraction**0.5, HEIGHT * fraction**0.5
    return np.array([[0, 0], [side_w, 0], [side_w, side_h], [0, side_h]], dtype=np.float32)


class FakeOcr:
    """Two words on a dark frame; four on a bright one, plus a line too unsure to
    count and a single character that is not a word. Counts its calls."""

    def __init__(self):
        self.calls = 0

    def __call__(self, frame):
        self.calls += 1
        if frame.mean() < 128:
            return [OcrLine("Hello world", 0.95, box(0.10))]
        return [
            OcrLine("Big slide text here", 0.99, box(0.20)),
            OcrLine("noise words", 0.30, box(0.50)),
            OcrLine("U", 0.97, box(0.01)),
        ]


def write_video(path, segments):
    """segments: (seconds, gray level) pairs, written as uniform frames."""
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), FPS, (WIDTH, HEIGHT))
    for seconds, level in segments:
        for _ in range(int(seconds * FPS)):
            writer.write(np.full((HEIGHT, WIDTH, 3), level, dtype=np.uint8))
    writer.release()


class TestCountWords(unittest.TestCase):
    def test_counts_tokens_with_two_letters_or_digits(self):
        # Key, Point:, f(x, and 7u count; y), =, the lone ∂x, U and 中 do not.
        self.assertEqual(count_words("Key Point: f(x, y) = ∂x U 中 7u"), 4)


class TestCalculateTextStats(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.video = Path(self.directory.name) / "slides.avi"
        # 15 s dark, 15 s bright: samples at 2.5, 7.5, ... 27.5 s.
        write_video(self.video, [(15, 40), (15, 220)])

    def test_samples_every_interval_and_reuses_unchanged_frames(self):
        ocr = FakeOcr()
        stats = calculate_text_stats(self.video, ocr=ocr, sample_secs=5.0)

        self.assertEqual(stats.sample_count, 6)
        self.assertEqual([s.t for s in stats.samples], [2.5, 7.5, 12.5, 17.5, 22.5, 27.5])
        # One read per slide; the other four samples carry it.
        self.assertEqual(ocr.calls, 2)
        self.assertEqual([s.reused for s in stats.samples], [False, True, True, False, True, True])

    def test_summarises_kept_lines_only(self):
        stats = calculate_text_stats(self.video, ocr=FakeOcr(), sample_secs=5.0)

        self.assertEqual([s.words for s in stats.samples], [2, 2, 2, 4, 4, 4])
        self.assertAlmostEqual(stats.mean_words, 3.0)
        self.assertEqual(stats.max_words, 4)
        self.assertEqual(stats.text_frames_ratio, 1.0)
        # 10% of the frame, then 20% + 1% (the "U" line is kept, it just has no
        # words); the unsure 50% box is dropped.
        self.assertAlmostEqual(stats.mean_coverage, (0.10 * 3 + 0.21 * 3) / 6, places=3)
        self.assertEqual(stats.samples[3].text, "Big slide text here\nU")

    def test_a_short_video_still_gets_one_sample(self):
        short = Path(self.directory.name) / "short.avi"
        write_video(short, [(2, 40)])
        stats = calculate_text_stats(short, ocr=FakeOcr(), sample_secs=5.0)
        self.assertEqual(stats.sample_count, 1)

    def test_rejects_a_file_that_is_not_a_video(self):
        junk = Path(self.directory.name) / "junk.avi"
        junk.write_bytes(b"not a video")
        with self.assertRaises(RuntimeError):
            calculate_text_stats(junk, ocr=FakeOcr())


OLD_JOBS = """
    CREATE TABLE files (file_hash TEXT PRIMARY KEY, file_ext TEXT NOT NULL);
    CREATE TABLE jobs (
        kind             TEXT NOT NULL CHECK (kind IN ('transcript', 'scene_stats')),
        file_hash        TEXT NOT NULL REFERENCES files(file_hash),
        status           TEXT NOT NULL CHECK (status IN ('queued', 'running', 'failed')),
        attempts         INTEGER NOT NULL DEFAULT 0,
        error            TEXT,
        lease_expires_at TEXT,
        updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (kind, file_hash),
        CHECK ((status = 'running') = (lease_expires_at IS NOT NULL))
    );
    INSERT INTO files VALUES ('abc', 'mp4');
    INSERT INTO jobs (kind, file_hash, status, attempts, error)
        VALUES ('scene_stats', 'abc', 'failed', 2, 'boom');
"""


class TestMigrateJobsKinds(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.executescript(OLD_JOBS)

    def insert_text_stats_job(self):
        with self.conn:
            self.conn.execute(
                "INSERT INTO jobs (kind, file_hash, status) VALUES ('text_stats', 'abc', 'queued')"
            )

    def test_old_table_rejects_the_new_kind(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_text_stats_job()

    def test_rebuild_admits_every_kind_and_keeps_rows(self):
        _migrate_jobs_kinds(self.conn)
        self.insert_text_stats_job()

        rows = self.conn.execute(
            "SELECT kind, status, attempts, error FROM jobs ORDER BY kind"
        ).fetchall()
        self.assertEqual(rows, [("scene_stats", "failed", 2, "boom"), ("text_stats", "queued", 0, None)])
        ddl = self.conn.execute("SELECT sql FROM sqlite_master WHERE name = 'jobs'").fetchone()[0]
        for name in KINDS:
            self.assertIn(f"'{name}'", ddl)

    def test_is_a_no_op_once_current(self):
        _migrate_jobs_kinds(self.conn)
        before = self.conn.execute("SELECT sql FROM sqlite_master WHERE name = 'jobs'").fetchone()
        _migrate_jobs_kinds(self.conn)
        after = self.conn.execute("SELECT sql FROM sqlite_master WHERE name = 'jobs'").fetchone()
        self.assertEqual(before, after)
        self.assertIsNone(
            self.conn.execute("SELECT name FROM sqlite_master WHERE name = '_old_jobs'").fetchone()
        )


if __name__ == "__main__":
    unittest.main()
