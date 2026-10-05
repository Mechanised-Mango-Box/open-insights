import { DatasetSettings } from './Dataset';
import { SPEECH_PACE_WINDOW_SECS } from './speech-features';

/**
 * The settings the transcript stats are computed with here. The counts come with the
 * transcript; the speech features are this browser's, over windows of this size.
 */
export const TRANSCRIPT_STATS_SETTINGS: DatasetSettings = {
  pace_window_secs: SPEECH_PACE_WINDOW_SECS,
};

/** How the transcript stats are computed - always in this browser, whichever
 * provider made the transcript. */
export const TRANSCRIPT_STATS_METHOD =
  'Computed in this browser from the transcript. Word and character counts come from the ' +
  'transcript text. Speech pace variation is the sample standard deviation of words per ' +
  "minute across consecutive windows of the pace window length, with each segment's words " +
  'shared between windows in proportion to its overlap. Both are measured against the ' +
  "video's duration (YouTube report, then scene stats, then the file itself, then audio stats).";

type SettingLabel = { label: string; unit?: string };

/** How each setting reads in a sentence. The keys are the server's (the *_SETTINGS in
 * server/config.py) and the browser computers'; an unknown key reads as itself. */
const SETTING_LABELS: Record<string, SettingLabel> = {
  // Scene stats: the mean grey-level change between frames, out of 255, that counts as a cut.
  threshold: { label: 'scene-change threshold', unit: ' (of 255)' },
  model: { label: 'model' },
  language: { label: 'language' },
  vad: { label: 'voice filter' },
  sample_secs: { label: 'one frame every', unit: 's' },
  reuse_threshold: { label: 'reuse threshold', unit: ' (of 255)' },
  min_score: { label: 'min. confidence' },
  pace_window_secs: { label: 'pace window', unit: 's' },
  // Audio stats.
  pitch: { label: 'pitch tracker' },
  frame_secs: { label: 'loudness frame', unit: 's' },
  background_margin_db: { label: 'background margin', unit: ' dB' },
  silence_dbfs: { label: 'silence floor', unit: ' dBFS' },
  pitch_floor_hz: { label: 'pitch floor', unit: ' Hz' },
  pitch_ceiling_hz: { label: 'pitch ceiling', unit: ' Hz' },
  pause_min_silence_ms: { label: 'pause silence', unit: ' ms' },
  pause_pad_ms: { label: 'pause padding', unit: ' ms' },
  pitch_time_step_secs: { label: 'pitch step', unit: 's' },
  pitch_min_voiced_secs: { label: 'min. voiced speech', unit: 's' },
  octave_error_st: { label: 'octave-error cut-off', unit: ' st' },
};

/** The transcript's `vad` is a flag (Whisper's voice filter); audio stats' is the
 * name of the speech detector. Same key, two meanings - told apart by type. */
const labelFor = (key: string, value: string | number | boolean): SettingLabel =>
  key === 'vad' && typeof value === 'string'
    ? { label: 'speech detector' }
    : (SETTING_LABELS[key] ?? { label: key });

/** Each setting as a label and its value with units, for a table. */
export const settingsRows = (
  settings: DatasetSettings | undefined,
): { key: string; label: string; value: string }[] =>
  Object.entries(settings ?? {}).map(([key, value]) => {
    const { label, unit } = labelFor(key, value);
    const shown = typeof value === 'boolean' ? (value ? 'on' : 'off') : `${value}${unit ?? ''}`;
    return { key, label, value: shown };
  });

/** "scene-change threshold 30 (of 255)", "model tiny.en, language en, voice filter off" -
 * or null when a value was made before results carried their settings. */
export const describeSettings = (settings: DatasetSettings | undefined): string | null => {
  const parts = settingsRows(settings).map(({ label, value }) => `${label} ${value}`);
  return parts.length > 0 ? parts.join(', ') : null;
};
