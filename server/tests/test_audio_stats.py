"""Check the audio measures: background sound (coherence) and pitch variation
(voice).

Speech detection is replaced by a stand-in that returns the intervals each test
names, so synthetic tones can play the speaker and every expected number can be
worked out by hand. Pitch runs through the real Praat, except where a test needs
the tracker to make a mistake. Run from the repository root:

    python -m unittest server.tests.test_audio_stats
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

# Add server/ to Python's search path so its top-level modules are found when
# this file is run directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import audio_stats
from audio_stats import SAMPLE_RATE, calculate_audio_stats, measure_audio, praat_pitch
from tests.video_fixtures import write_audio, write_mjpeg


def tone(seconds, hz, amplitude=0.5):
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * hz * t)).astype(np.float32)


def noise(seconds, dbfs, seed=0):
    """White noise at an RMS level of `dbfs`."""
    rng = np.random.default_rng(seed)
    return (rng.standard_normal(int(seconds * SAMPLE_RATE)) * 10 ** (dbfs / 20)).astype(
        np.float32
    )


def silence(seconds):
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def speech_at(*intervals):
    return lambda audio: list(intervals)


class TestBackgroundSound(unittest.TestCase):
    """A 0.5-amplitude tone is -9 dBFS RMS, so with the default 20 dB margin
    anything at -29 dBFS or louder outside speech is background sound."""

    def test_counts_loud_sound_outside_speech(self):
        audio = np.concatenate([tone(2, 200), silence(2), noise(2, -15)])
        stats = measure_audio(audio, speech_at((0, 2)), praat_pitch)
        self.assertAlmostEqual(stats.speech_secs, 2.0)
        self.assertAlmostEqual(stats.speech_level_db, -9.03, places=1)
        self.assertAlmostEqual(stats.background_sound_ratio, 2 / 6, places=4)

    def test_room_tone_well_below_the_speaker_is_not_background(self):
        # -35 dBFS is above the silence floor but 26 dB under the speaker.
        audio = np.concatenate([tone(2, 200), noise(4, -35)])
        stats = measure_audio(audio, speech_at((0, 2)), praat_pitch)
        self.assertEqual(stats.background_sound_ratio, 0.0)

    def test_the_margin_follows_the_speaker_not_full_scale(self):
        # The same scene recorded 30 dB quieter reads the same.
        audio = np.concatenate([tone(2, 200), silence(2), noise(2, -15)])
        loud = measure_audio(audio, speech_at((0, 2)), praat_pitch)
        quiet = measure_audio(audio * 10 ** (-30 / 20), speech_at((0, 2)), praat_pitch)
        self.assertAlmostEqual(quiet.background_sound_ratio, loud.background_sound_ratio)

    def test_with_no_speech_only_the_silence_floor_applies(self):
        audio = np.concatenate([silence(2), noise(2, -40), noise(2, -60)])
        stats = measure_audio(audio, speech_at(), praat_pitch)
        self.assertEqual(stats.speech_secs, 0.0)
        self.assertIsNone(stats.speech_level_db)
        self.assertAlmostEqual(stats.background_sound_ratio, 2 / 6, places=4)
        self.assertIsNone(stats.median_pitch_hz)
        self.assertEqual(stats.pitch_variation_st, 0.0)


class TestPitchVariation(unittest.TestCase):
    def test_a_steady_voice_does_not_vary(self):
        stats = measure_audio(tone(3, 200), speech_at((0, 3)), praat_pitch)
        self.assertAlmostEqual(stats.median_pitch_hz, 200, delta=1)
        self.assertLess(stats.pitch_variation_st, 0.1)

    def test_two_pitches_a_fifth_apart(self):
        # 200 and 300 Hz are 7.02 semitones apart; half the frames at each puts
        # the standard deviation at half that.
        audio = np.concatenate([tone(1.5, 200), tone(1.5, 300)])
        stats = measure_audio(audio, speech_at((0, 3)), praat_pitch)
        self.assertAlmostEqual(stats.pitch_variation_st, 3.51, delta=0.3)

    def test_the_same_in_semitones_whatever_the_voice(self):
        low = measure_audio(
            np.concatenate([tone(1.5, 100), tone(1.5, 150)]), speech_at((0, 3)), praat_pitch
        )
        high = measure_audio(
            np.concatenate([tone(1.5, 200), tone(1.5, 300)]), speech_at((0, 3)), praat_pitch
        )
        self.assertAlmostEqual(low.pitch_variation_st, high.pitch_variation_st, delta=0.3)

    def test_pitch_outside_speech_is_ignored(self):
        # Music after a pause is not the speaker. The pause stands in for the
        # padding real VAD puts round speech; without it, Praat's frames on the
        # boundary hear both tones at once.
        audio = np.concatenate([tone(2, 200), silence(0.5), tone(2, 300)])
        stats = measure_audio(audio, speech_at((0, 2)), praat_pitch)
        self.assertAlmostEqual(stats.median_pitch_hz, 200, delta=1)
        self.assertLess(stats.pitch_variation_st, 0.1)

    def test_chunking_keeps_each_frame_at_its_own_time(self):
        audio = np.concatenate(
            [tone(2, 200), silence(0.5), tone(2, 300), silence(0.5), tone(2, 200)]
        )
        speech = speech_at((0, 2), (5, 7))
        whole = measure_audio(audio, speech, praat_pitch)
        with mock.patch.object(audio_stats, "_PITCH_CHUNK_SECS", 0.7):
            chunked = measure_audio(audio, speech, praat_pitch)
        self.assertAlmostEqual(chunked.median_pitch_hz, 200, delta=1)
        self.assertLess(chunked.pitch_variation_st, 0.1)
        self.assertAlmostEqual(chunked.median_pitch_hz, whole.median_pitch_hz, delta=1)

    def test_octave_errors_are_dropped(self):
        def tracker(audio, floor_hz, ceiling_hz):
            times = np.arange(0, len(audio) / SAMPLE_RATE, 0.01)
            freqs = np.full(len(times), 200.0)
            freqs[::10] = 450.0  # More than an octave up, one frame in ten.
            return times, freqs

        stats = measure_audio(silence(3) + 0.1, speech_at((0, 3)), tracker)
        self.assertEqual(stats.median_pitch_hz, 200.0)
        self.assertEqual(stats.pitch_variation_st, 0.0)

    def test_audio_shorter_than_praats_window_is_not_an_error(self):
        # 20 ms is under three periods of the 75 Hz floor, which Praat refuses.
        stats = measure_audio(tone(0.02, 200), speech_at((0, 0.02)), praat_pitch)
        self.assertIsNone(stats.median_pitch_hz)

    def test_no_short_chunk_is_left_at_the_end(self):
        seen = []

        def tracker(audio, floor_hz, ceiling_hz):
            seen.append(len(audio) / SAMPLE_RATE)
            return praat_pitch(audio, floor_hz, ceiling_hz)

        with mock.patch.object(audio_stats, "_PITCH_CHUNK_SECS", 1.0):
            measure_audio(tone(3.01, 200), speech_at((0, 3.01)), tracker)
        self.assertEqual(len(seen), 3)
        self.assertGreater(min(seen), 0.9)

    def test_too_little_voiced_speech_reports_no_pitch(self):
        audio = np.concatenate([tone(0.5, 200), silence(2.5)])
        stats = measure_audio(audio, speech_at((0, 0.5)), praat_pitch)
        self.assertIsNone(stats.median_pitch_hz)
        self.assertEqual(stats.pitch_variation_st, 0.0)


class TestCalculateAudioStats(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_decodes_the_audio_track(self):
        path = self.dir / "talk.mkv"
        write_audio(path, np.concatenate([tone(2, 200), silence(1), noise(1, -15)]))
        stats = calculate_audio_stats(path, vad=speech_at((0, 2)))
        self.assertAlmostEqual(stats.duration_secs, 4.0, delta=0.01)
        self.assertAlmostEqual(stats.background_sound_ratio, 0.25, delta=0.01)
        self.assertAlmostEqual(stats.median_pitch_hz, 200, delta=1)

    def test_a_video_with_no_audio_track_is_silent_not_failed(self):
        path = self.dir / "mute.avi"
        write_mjpeg(path, [(2, 50)])
        stats = calculate_audio_stats(path, vad=speech_at((0, 1)))
        self.assertAlmostEqual(stats.duration_secs, 2.0, delta=0.2)
        self.assertEqual(stats.speech_secs, 0.0)
        self.assertIsNone(stats.speech_level_db)
        self.assertEqual(stats.background_sound_ratio, 0.0)
        self.assertIsNone(stats.median_pitch_hz)
        self.assertEqual(stats.pitch_variation_st, 0.0)

    def test_an_audio_track_that_decodes_to_nothing_fails(self):
        # A truncated download: the track is there, its samples are not.
        path = self.dir / "cut.mkv"
        write_audio(path, tone(1, 200))
        with mock.patch("faster_whisper.audio.decode_audio", return_value=np.empty(0)):
            with self.assertRaises(RuntimeError):
                calculate_audio_stats(path)

    def test_rejects_a_file_that_is_not_media(self):
        path = self.dir / "notes.mp4"
        path.write_bytes(b"not a video at all")
        with self.assertRaises(RuntimeError):
            calculate_audio_stats(path)


if __name__ == "__main__":
    unittest.main()
