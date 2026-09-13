import { describe, expect, it } from 'vitest';
import { AsrOutput, toTranscriptSegments, wholeAsOneSegment } from './transcript-segments';
import { computeTranscriptStats } from '../../video-records/Dataset';

const output = (chunks: AsrOutput['chunks'], text = ''): AsrOutput => ({ text, chunks });

describe('toTranscriptSegments', () => {
  it('carries timings and text straight through', () => {
    const segments = toTranscriptSegments(
      output([
        { timestamp: [0, 2.5], text: ' Hello there.' },
        { timestamp: [2.5, 5], text: ' General Kenobi.' },
      ]),
    );

    expect(segments).toEqual([
      { start: 0, end: 2.5, text: ' Hello there.' },
      { start: 2.5, end: 5, text: ' General Kenobi.' },
    ]);
  });

  it('closes an unclosed chunk with the next one it has', () => {
    const segments = toTranscriptSegments(
      output([
        { timestamp: [0, null], text: ' first' },
        { timestamp: [4, 6], text: ' second' },
      ]),
    );

    expect(segments[0].end).toBe(4);
  });

  it('closes a trailing unclosed chunk with the audio duration', () => {
    const segments = toTranscriptSegments(output([{ timestamp: [10, null], text: ' last' }]), 12.5);
    expect(segments[0].end).toBe(12.5);
  });

  it('falls back to a point in time when nothing can close the chunk', () => {
    const segments = toTranscriptSegments(output([{ timestamp: [10, null], text: ' last' }]));
    expect(segments[0]).toEqual({ start: 10, end: 10, text: ' last' });
  });

  it('drops silent chunks rather than exporting empty subtitles', () => {
    const segments = toTranscriptSegments(
      output([
        { timestamp: [0, 1], text: ' words' },
        { timestamp: [1, 4], text: '   ' },
        { timestamp: [4, 5], text: ' more' },
      ]),
    );

    expect(segments).toHaveLength(2);
    // The dropped chunk must not become the closing timestamp of the one before
    // it - that would stretch a one-second line across four.
    expect(segments[0].end).toBe(1);
  });

  it('returns nothing for a result with no chunks', () => {
    expect(toTranscriptSegments(output([]))).toEqual([]);
    expect(toTranscriptSegments({ text: 'x' })).toEqual([]);
  });

  it('produces segments the existing stats function can count', () => {
    const segments = toTranscriptSegments(
      output([
        { timestamp: [0, 1], text: ' one two' },
        { timestamp: [1, 2], text: ' three' },
      ]),
    );

    expect(computeTranscriptStats({ segments })).toEqual({ count_chars: 15, count_words: 3 });
  });
});

describe('wholeAsOneSegment', () => {
  it('keeps an untimed transcript usable', () => {
    expect(wholeAsOneSegment({ text: ' some words ' }, 30)).toEqual([
      { start: 0, end: 30, text: ' some words ' },
    ]);
  });

  it('returns nothing for silence', () => {
    expect(wholeAsOneSegment({ text: '   ' }, 30)).toEqual([]);
  });
});
