import { isReady, readyData } from '../video-records/Dataset';
import { VideoRecord } from '../video-records/VideoRecord';
import {
  ANALYSIS_FEATURE_COLUMNS,
  AnalysisFeatureColumn,
  durationSourceFor,
  requiredSourcesFor,
} from '../analysis/stats';

/** One piece of Scan work the model's features depend on. */
export type ScanStep = 'sceneStats' | 'transcript' | 'transcriptStats' | 'textStats' | 'audioStats';

/** Lower-case because they sit mid-sentence in the scan-first dialog and the
 * progress line. */
export const SCAN_STEP_LABELS: Record<ScanStep, string> = {
  sceneStats: 'scene stats',
  transcript: 'transcript and its stats',
  transcriptStats: 'transcript stats',
  textStats: 'screen text',
  audioStats: 'audio stats',
};

/**
 * The Scan work still missing before buildFeaturesFor() can compute `features`
 * for this record (every feature unless a model asks for fewer), in the order it
 * has to run. Only the scans those features come from are asked for.
 *
 * The scan that carries the duration comes first - scene stats, or audio stats
 * for a feature set with no scene feature (durationSourceFor) - because the
 * speech features are computed against a duration, so a transcript fetched
 * before any is known would come back with those features null and need
 * recomputing anyway.
 *
 * A transcript is only fetched when there is none. One already held with stale
 * or incomplete stats just needs them recomputed locally, which costs no server
 * round trip - the same split the Scan page offers as two separate buttons.
 */
export const missingScanSteps = (
  record: VideoRecord,
  features: readonly AnalysisFeatureColumn[] = ANALYSIS_FEATURE_COLUMNS,
): ScanStep[] => {
  const steps: ScanStep[] = [];
  const sources = requiredSourcesFor(features);
  const durationFromAudio = durationSourceFor(features) === 'audioStats';

  // A result held from before speech and pauses were measured lacks
  // speech_ratio, and scanning again is what fills it in.
  const audioStats = readyData(record.ds_audioStats);
  const audioMissing =
    !audioStats ||
    audioStats.speech_ratio === undefined ||
    (durationFromAudio && audioStats.duration_secs <= 0);

  if (sources.includes('sceneStats')) {
    const sceneStats = readyData(record.ds_sceneStats);
    if (!sceneStats || sceneStats.duration_secs <= 0) steps.push('sceneStats');
  }
  if (durationFromAudio && audioMissing) steps.push('audioStats');

  if (sources.includes('transcriptStats')) {
    const stats = readyData(record.ds_transcriptStats);
    const statsComplete =
      !!stats &&
      (!features.includes('speech_pace_variation') || stats.speech_pace_variation != null);
    if (!statsComplete) {
      steps.push(isReady(record.ds_transcript) ? 'transcriptStats' : 'transcript');
    }
  }

  // Independent of the steps above - OCR needs no duration or transcript - so it
  // simply goes last.
  if (sources.includes('textStats') && !isReady(record.ds_textStats)) steps.push('textStats');

  // Likewise independent, unless it already went first for the duration.
  if (sources.includes('audioStats') && audioMissing && !steps.includes('audioStats'))
    steps.push('audioStats');

  return steps;
};
