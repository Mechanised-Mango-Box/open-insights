import { VideoRecord } from '../video-records/VideoRecord';
import { featureSkipReason } from './analysis.service';
import { AnalysisFeatureColumn, FEATURE_PRESETS, FeaturePreset } from './stats';

/**
 * Plain functions behind the Create Model dialog, kept out of the component so
 * they can be tested without an injector.
 */

/** Below this the server will not train: too few rows to split 80/20 and still
 * fit the features. Mirrors MIN_TRAINING_ROWS in server/model_training/data_preparation.py. */
export const MIN_TRAINING_ROWS = 10;

/** What each feature set is called and for. Mirrors DEFAULT_META in
 * server/scripts/train_engagement_model.py, cut to a line each. */
export const PRESET_LABELS: Record<FeaturePreset, { name: string; description: string }> = {
  lite: {
    name: 'Lite',
    description:
      'Duration, speaking speed, speech pace variation and mean pause - the features that ' +
      'predicted best in testing.',
  },
  all: {
    name: 'All features',
    description: 'All eight features. The most information, and the slowest to scan for.',
  },
  video: {
    name: 'Video only',
    description: 'Duration, scene change rate and on-screen text - what can be seen, not heard.',
  },
  audio: {
    name: 'Audio only',
    description: 'Duration plus the transcript and audio features - what can be heard, not seen.',
  },
};

/** The preset these features are exactly, or null when they are a set of their own. */
export const matchingPreset = (features: readonly AnalysisFeatureColumn[]): FeaturePreset | null =>
  (Object.keys(FEATURE_PRESETS) as FeaturePreset[]).find((id) => {
    const preset: readonly AnalysisFeatureColumn[] = FEATURE_PRESETS[id];
    return preset.length === features.length && preset.every((f) => features.includes(f));
  }) ?? null;

/** Mirrors MODEL_ID_PATTERN in server/model_training/model_card.py. */
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * How many of these records a model on `features` would learn from: the ones
 * whose Scan results supply every feature and that have a YouTube average view
 * duration to learn from - the same test the server applies to the manifest.
 */
export const trainableCount = (
  records: readonly VideoRecord[],
  features: readonly AnalysisFeatureColumn[],
): number =>
  records.filter(
    (record) =>
      featureSkipReason(record, features) === null &&
      record.ds_youtubeContent?.average_view_duration_secs != null,
  ).length;

/** A model id from its name: "My Lectures (2026)" -> "my-lectures-2026". Empty
 * when the name has no letters or digits, which the id field then asks for. */
export const slugify = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');

/** What went wrong with a training request, in words for the dialog. */
export const describeTrainError = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status, error: body } = error as { status: number; error?: unknown };
    const detail =
      typeof body === 'object' && body !== null && 'err' in body
        ? String((body as { err: unknown }).err)
        : null;
    if (status === 0) return 'The server could not be reached.';
    if (status === 429 || status === 503) {
      return (
        "This server's limit on new models has been reached. Try again later, or run your own " +
        'server, which has no limit.'
      );
    }
    if (status === 404 || status === 405) {
      return 'This server is too old to train models. Update it, or use another.';
    }
    return detail ?? `The server refused it (HTTP ${status}).`;
  }
  return error instanceof Error ? error.message : String(error);
};
