import { describe, expect, it } from 'vitest';
import { describeSettings, settingsRows } from './dataset-settings';

describe('describeSettings', () => {
  it("reads the server's scene and OCR settings as a sentence", () => {
    expect(describeSettings({ threshold: 30 })).toBe('scene-change threshold 30 (of 255)');
    expect(
      describeSettings({
        model: 'PP-OCRv6-small',
        sample_secs: 5,
        reuse_threshold: 3,
        min_score: 0.8,
      }),
    ).toBe(
      'model PP-OCRv6-small, one frame every 5s, reuse threshold 3 (of 255), min. confidence 0.8',
    );
  });

  it("gives the audio settings units, and tells audio's speech detector from Whisper's flag", () => {
    expect(
      describeSettings({
        vad: 'silero-vad',
        pitch: 'praat-ac',
        background_margin_db: 20,
        silence_dbfs: -50,
        pitch_floor_hz: 75,
        pause_min_silence_ms: 250,
        octave_error_st: 12,
      }),
    ).toBe(
      'speech detector silero-vad, pitch tracker praat-ac, background margin 20 dB, ' +
        'silence floor -50 dBFS, pitch floor 75 Hz, pause silence 250 ms, octave-error cut-off 12 st',
    );
  });

  it('lists the same settings as rows for a table', () => {
    expect(settingsRows({ frame_secs: 0.05, vad: true })).toEqual([
      { key: 'frame_secs', label: 'loudness frame', value: '0.05s' },
      { key: 'vad', label: 'voice filter', value: 'on' },
    ]);
  });

  it('reads a flag as on or off', () => {
    expect(describeSettings({ vad: false })).toBe('voice filter off');
  });

  it('names a setting it has no label for by its key, rather than dropping it', () => {
    expect(describeSettings({ new_knob: 2 })).toBe('new_knob 2');
  });

  it('says nothing for a value made before results carried settings', () => {
    expect(describeSettings(undefined)).toBeNull();
    expect(describeSettings({})).toBeNull();
  });
});
