import { describe, expect, it } from 'vitest';
import { describeSettings } from './dataset-settings';

describe('describeSettings', () => {
  it("reads the server's scene and OCR settings as a sentence", () => {
    expect(describeSettings({ threshold: 30 })).toBe('scene-change threshold 30');
    expect(
      describeSettings({
        model: 'PP-OCRv6-small',
        sample_secs: 5,
        reuse_threshold: 3,
        min_score: 0.8,
      }),
    ).toBe('model PP-OCRv6-small, one frame every 5s, reuse threshold 3, min. confidence 0.8');
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
