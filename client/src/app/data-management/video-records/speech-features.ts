import type { Transcript } from './Dataset';

/** The window speech pace variation measures WPM over. */
export const SPEECH_PACE_WINDOW_SECS = 30;

/**
 * Calculates speech pace variation (sample standard deviation of WPM across fixed 30-second time windows).
 *
 * Proportional word allocation is used for transcript segments that cross window boundaries:
 * words_in_window = segment_words * (overlap_duration / segment_duration).
 *
 * Intermediate per-window word counts maintain floating-point precision to avoid cumulative distortion.
 */
export function calculateSpeechPaceVariation(
  transcript: Transcript | null | undefined,
  durationSecs: number,
  windowSizeSecs: number = SPEECH_PACE_WINDOW_SECS,
): number {
  if (
    !transcript?.segments ||
    transcript.segments.length === 0 ||
    durationSecs <= 0 ||
    windowSizeSecs <= 0
  ) {
    return 0;
  }

  const numWindows = Math.ceil(durationSecs / windowSizeSecs);
  if (numWindows < 2) {
    return 0;
  }

  const windowWords = new Array<number>(numWindows).fill(0);

  for (const seg of transcript.segments) {
    const start = seg.start;
    const end = seg.end;
    if (isNaN(start) || isNaN(end) || end <= start) {
      continue;
    }

    const segDuration = end - start;
    const words = seg.text ? seg.text.trim().split(/\s+/).filter(Boolean).length : 0;
    if (words === 0) {
      continue;
    }

    for (let k = 0; k < numWindows; k++) {
      const wStart = k * windowSizeSecs;
      const wEnd = Math.min(durationSecs, (k + 1) * windowSizeSecs);
      const overlap = Math.max(0, Math.min(end, wEnd) - Math.max(start, wStart));
      if (overlap > 0) {
        windowWords[k] += words * (overlap / segDuration);
      }
    }
  }

  const windowWpm = new Array<number>(numWindows);
  for (let k = 0; k < numWindows; k++) {
    const wStart = k * windowSizeSecs;
    const wEnd = Math.min(durationSecs, (k + 1) * windowSizeSecs);
    const windowDurationSecs = wEnd - wStart;
    const windowDurationMins = windowDurationSecs / 60.0;
    windowWpm[k] = windowDurationMins > 0 ? windowWords[k] / windowDurationMins : 0;
  }

  const meanWpm = windowWpm.reduce((sum, val) => sum + val, 0) / numWindows;
  const variance =
    windowWpm.reduce((sum, val) => sum + Math.pow(val - meanWpm, 2), 0) / (numWindows - 1);

  return Math.sqrt(variance);
}
