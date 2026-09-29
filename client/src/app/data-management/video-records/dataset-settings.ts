import { DatasetSettings } from './Dataset';
import { SPEECH_PACE_WINDOW_SECS } from './speech-features';

/**
 * The settings the transcript stats are computed with here. The counts come with the
 * transcript; the speech features are this browser's, over windows of this size.
 */
export const TRANSCRIPT_STATS_SETTINGS: DatasetSettings = {
  pace_window_secs: SPEECH_PACE_WINDOW_SECS,
};

/** How each setting reads in a sentence. The keys are the server's (the *_SETTINGS in
 * server/config.py) and the browser computers'; an unknown key reads as itself. */
const SETTING_LABELS: Record<string, { label: string; unit?: string }> = {
  // Scene stats: the mean grey-level change between frames, out of 255, that counts as a cut.
  threshold: { label: 'scene-change threshold' },
  model: { label: 'model' },
  language: { label: 'language' },
  vad: { label: 'voice filter' },
  sample_secs: { label: 'one frame every', unit: 's' },
  reuse_threshold: { label: 'reuse threshold' },
  min_score: { label: 'min. confidence' },
  pace_window_secs: { label: 'pace window', unit: 's' },
};

/** "scene-change threshold 30", "model tiny.en, language en, voice filter off" - or null
 * when a value was made before results carried their settings. */
export const describeSettings = (settings: DatasetSettings | undefined): string | null => {
  if (!settings) return null;
  const parts = Object.entries(settings).map(([key, value]) => {
    const { label, unit } = SETTING_LABELS[key] ?? { label: key };
    const shown = typeof value === 'boolean' ? (value ? 'on' : 'off') : `${value}${unit ?? ''}`;
    return `${label} ${shown}`;
  });
  return parts.length > 0 ? parts.join(', ') : null;
};
