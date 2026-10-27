import { describe, expect, it } from 'vitest';
import { calculateSpeechPaceVariation } from './speech-features';
import { Transcript } from '../video-records/Dataset';

describe('speech-features', () => {
  describe('calculateSpeechPaceVariation', () => {
    it('1. returns 0 when there are no transcript segments', () => {
      expect(calculateSpeechPaceVariation(null, 60)).toBe(0);
      expect(calculateSpeechPaceVariation({ segments: [] }, 60)).toBe(0);
    });

    it('2. returns 0 when video duration is shorter than 30 seconds (1 window)', () => {
      const transcript: Transcript = {
        segments: [{ start: 0, end: 20, text: 'Hello world testing pace' }],
      };
      expect(calculateSpeechPaceVariation(transcript, 25)).toBe(0);
    });

    it('3. returns 0 when exactly two windows have identical WPM', () => {
      // Window 1 (0-30s): 10 words in 30s -> 20 WPM
      // Window 2 (30-60s): 10 words in 30s -> 20 WPM
      const transcript: Transcript = {
        segments: [
          { start: 0, end: 30, text: 'one two three four five six seven eight nine ten' },
          { start: 30, end: 60, text: 'one two three four five six seven eight nine ten' },
        ],
      };
      expect(calculateSpeechPaceVariation(transcript, 60)).toBe(0);
    });

    it('4. returns positive standard deviation for two windows with different WPM', () => {
      // Window 1 (0-30s): 10 words -> 20 WPM
      // Window 2 (30-60s): 30 words -> 60 WPM
      const transcript: Transcript = {
        segments: [
          { start: 0, end: 30, text: 'word '.repeat(10).trim() },
          { start: 30, end: 60, text: 'word '.repeat(30).trim() },
        ],
      };
      const result = calculateSpeechPaceVariation(transcript, 60);
      // stddev([20, 60]) = sqrt(((20-40)^2 + (60-40)^2) / 1) = sqrt(800) ≈ 28.284
      expect(result).toBeCloseTo(Math.sqrt(800), 3);
    });

    it('5. handles a segment crossing a 30-second boundary with proportional word allocation', () => {
      // Segment: start=20s, end=40s (duration=20s), 20 words
      // Window 1 (0-30s): overlap=10s -> 10 words. WPM = 10 / 0.5 = 20 WPM
      // Window 2 (30-60s): overlap=10s -> 10 words. WPM = 10 / 0.5 = 20 WPM
      const transcript: Transcript = {
        segments: [{ start: 20, end: 40, text: 'word '.repeat(20).trim() }],
      };
      expect(calculateSpeechPaceVariation(transcript, 60)).toBe(0);
    });

    it('6. correctly handles a shorter final window', () => {
      // Total duration 75s -> 3 windows: 0-30s, 30-60s, 60-75s (15s = 0.25 min)
      // Window 1 (0-30s): 10 words -> WPM = 10 / 0.5 = 20 WPM
      // Window 2 (30-60s): 10 words -> WPM = 10 / 0.5 = 20 WPM
      // Window 3 (60-75s): 5 words -> WPM = 5 / 0.25 = 20 WPM
      const transcript: Transcript = {
        segments: [
          { start: 0, end: 30, text: 'word '.repeat(10).trim() },
          { start: 30, end: 60, text: 'word '.repeat(10).trim() },
          { start: 60, end: 75, text: 'word '.repeat(5).trim() },
        ],
      };
      expect(calculateSpeechPaceVariation(transcript, 75)).toBeCloseTo(0, 5);
    });

    it('7. includes a silent window with zero words in standard deviation calculation', () => {
      // Window 1 (0-30s): 15 words -> 30 WPM
      // Window 2 (30-60s): 0 words -> 0 WPM
      const transcript: Transcript = {
        segments: [{ start: 0, end: 30, text: 'word '.repeat(15).trim() }],
      };
      const result = calculateSpeechPaceVariation(transcript, 60);
      // stddev([30, 0]) = sqrt(((30-15)^2 + (0-15)^2) / 1) = sqrt(450) ≈ 21.213
      expect(result).toBeCloseTo(Math.sqrt(450), 3);
    });

    it('8. ignores invalid timestamps (NaN or start >= end)', () => {
      const transcript: Transcript = {
        segments: [
          { start: NaN, end: 30, text: 'invalid start' },
          { start: 20, end: 10, text: 'reversed end' },
          { start: 0, end: 30, text: 'word '.repeat(10).trim() },
          { start: 30, end: 60, text: 'word '.repeat(10).trim() },
        ],
      };
      expect(calculateSpeechPaceVariation(transcript, 60)).toBe(0);
    });

    it('9. handles segments with zero duration or empty text', () => {
      const transcript: Transcript = {
        segments: [
          { start: 10, end: 10, text: 'zero duration' },
          { start: 0, end: 30, text: '   ' },
          { start: 0, end: 30, text: 'word '.repeat(10).trim() },
          { start: 30, end: 60, text: 'word '.repeat(10).trim() },
        ],
      };
      expect(calculateSpeechPaceVariation(transcript, 60)).toBe(0);
    });
  });
});
