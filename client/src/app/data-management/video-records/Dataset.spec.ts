import { describe, expect, it } from 'vitest';
import { formatDuration, formatTimestamp } from './Dataset';

describe('formatDuration', () => {
  it('omits the hours part below an hour', () => {
    expect(formatDuration(30)).toBe('0:30');
    expect(formatDuration(962)).toBe('16:02');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('adds hours once there are any, padding the minutes behind them', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3845)).toBe('1:04:05');
    expect(formatDuration(8120)).toBe('2:15:20');
  });

  it('truncates fractional seconds rather than rounding into a 60', () => {
    expect(formatDuration(59.9)).toBe('0:59');
  });

  // The reason formatDuration exists at all: formatTimestamp has no hours part,
  // so it is right for a transcript offset and wrong for a whole-video length.
  it('differs from formatTimestamp past an hour', () => {
    expect(formatTimestamp(4530)).toBe('75:30');
    expect(formatDuration(4530)).toBe('1:15:30');
  });
});
