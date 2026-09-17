import type { Transcript } from './Dataset';

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
  windowSizeSecs: number = 30,
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

/**
 * Calculates speaking ratio (the proportion of total video duration covered by detected Whisper speech segments).
 *
 * Timestamps are clamped to [0, durationSecs], sorted, and overlapping intervals are merged before summing.
 */
export function calculateSpeakingRatio(
  transcript: Transcript | null | undefined,
  durationSecs: number,
): number {
  if (!transcript?.segments || transcript.segments.length === 0 || durationSecs <= 0) {
    return 0;
  }

  const intervals: { start: number; end: number }[] = [];

  for (const seg of transcript.segments) {
    const start = seg.start;
    const end = seg.end;
    if (isNaN(start) || isNaN(end) || end <= start) {
      continue;
    }

    const clampedStart = Math.max(0, Math.min(durationSecs, start));
    const clampedEnd = Math.max(0, Math.min(durationSecs, end));

    if (clampedEnd > clampedStart) {
      intervals.push({ start: clampedStart, end: clampedEnd });
    }
  }

  if (intervals.length === 0) {
    return 0;
  }

  intervals.sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [{ ...intervals[0] }];
  for (let i = 1; i < intervals.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = intervals[i];
    if (curr.start <= prev.end) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push({ ...curr });
    }
  }

  const totalSpeakingTime = merged.reduce(
    (sum, interval) => sum + (interval.end - interval.start),
    0,
  );
  const ratio = totalSpeakingTime / durationSecs;

  return Math.min(1.0, Math.max(0.0, ratio));
}
