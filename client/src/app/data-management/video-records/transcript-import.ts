import { Transcript, TranscriptSegment } from './Dataset';

// Matches both SRT ("00:00:01,000 --> 00:00:04,000") and VTT ("00:00:01.000 --> 00:00:04.000")
// cue timing lines - the two formats differ only in the ',' vs '.' millisecond separator.
const TIMECODE_LINE = /(\d+):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[.,](\d{3})/;

const toSeconds = (h: string, m: string, s: string, ms: string): number =>
  Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

/**
 * Parses SRT/VTT cue blocks (separated by a blank line) into segments. Within a block,
 * everything before the timing line (a cue number, or the "WEBVTT" header/cue identifier)
 * is ignored, and everything after it is joined as the cue's text - this single scan works
 * for both formats without needing to special-case either one.
 */
const parseCueBlocks = (content: string): TranscriptSegment[] => {
  const segments: TranscriptSegment[] = [];
  const blocks = content.replace(/\r\n/g, '\n').split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    const timecodeIndex = lines.findIndex((line) => TIMECODE_LINE.test(line));
    if (timecodeIndex === -1) continue;

    const match = lines[timecodeIndex].match(TIMECODE_LINE)!;
    const start = toSeconds(match[1], match[2], match[3], match[4]);
    const end = toSeconds(match[5], match[6], match[7], match[8]);
    const text = lines
      .slice(timecodeIndex + 1)
      .join(' ')
      .trim();

    if (text) segments.push({ start, end, text });
  }

  return segments;
};

/** Parses an uploaded SRT/VTT transcript file. A file with no recognizable cues (a plain
 * .txt, say) yields no segments - transcripts are timestamped-only, so there's nothing
 * meaningful to salvage from untimed text; the caller reports that back to the user. */
export function parseTranscriptFile(content: string): Transcript {
  return { segments: parseCueBlocks(content) };
}
