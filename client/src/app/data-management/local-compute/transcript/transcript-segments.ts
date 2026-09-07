import { TranscriptSegment } from '../../video-records/Dataset';

/**
 * What transformers.js returns from a chunked speech-recognition run.
 *
 * `timestamp` is a pair, and its end is null on a chunk the model did not close
 * - most often the last one, where the audio simply stopped.
 */
export type AsrChunk = { timestamp: [number, number | null]; text: string };
export type AsrOutput = { text: string; chunks?: AsrChunk[] };

/**
 * Turns a recognition result into the segments a record stores.
 *
 * Kept apart from the worker because it is the one part of transcription that
 * can be tested without a model: the shapes either side of it are fixed, and
 * the null-end and empty-chunk cases are exactly where a transcript quietly
 * loses its timings.
 *
 * `duration` closes a final chunk that has no end of its own.
 */
export function toTranscriptSegments(output: AsrOutput, duration?: number): TranscriptSegment[] {
  const chunks = output.chunks ?? [];
  const segments: TranscriptSegment[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const { timestamp, text } = chunks[i];
    // A chunk of silence carries no words and no useful timing; keeping it
    // would put empty entries in an SRT export for no reason.
    if (!text.trim()) continue;

    const [start, end] = timestamp;
    // An unclosed chunk runs to whatever comes next: the following chunk's
    // start, or the end of the audio, and failing both it is a point in time
    // rather than a span.
    const nextStart = chunks[i + 1]?.timestamp[0];
    segments.push({ start, end: end ?? nextStart ?? duration ?? start, text });
  }

  return segments;
}

/**
 * The transcript with no chunk timings at all - some models return only text.
 * One segment spanning the whole audio keeps word counts and the SRT export
 * working, rather than dropping the transcript for want of timestamps.
 */
export function wholeAsOneSegment(output: AsrOutput, duration: number): TranscriptSegment[] {
  const text = output.text.trim();
  return text ? [{ start: 0, end: duration, text: output.text }] : [];
}
