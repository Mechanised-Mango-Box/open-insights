import { isReady, readyData } from '../video-records/Dataset';
import { VideoRecord } from '../video-records/VideoRecord';

/** One piece of Scan work the model's features depend on. */
export type ScanStep = 'sceneStats' | 'transcript' | 'transcriptStats';

/** Lower-case because they sit mid-sentence in the scan-first dialog and the
 * progress line. */
export const SCAN_STEP_LABELS: Record<ScanStep, string> = {
  sceneStats: 'scene stats',
  transcript: 'transcript and its stats',
  transcriptStats: 'transcript stats',
};

/**
 * The Scan work still missing before buildVideoFeatures() can score this record,
 * in the order it has to run.
 *
 * Scene stats come first because they carry the duration: the speech features
 * are computed against it, so a transcript fetched before any duration is known
 * would come back with those two features null and need recomputing anyway.
 *
 * A transcript is only fetched when there is none. One already held with stale
 * or incomplete stats just needs them recomputed locally, which costs no server
 * round trip - the same split the Scan page offers as two separate buttons.
 */
export const missingScanSteps = (record: VideoRecord): ScanStep[] => {
  const steps: ScanStep[] = [];

  const sceneStats = readyData(record.ds_sceneStats);
  if (!sceneStats || sceneStats.duration_secs <= 0) steps.push('sceneStats');

  const stats = readyData(record.ds_transcriptStats);
  const statsComplete =
    !!stats && stats.speech_pace_variation != null && stats.speaking_ratio != null;
  if (!statsComplete) {
    steps.push(isReady(record.ds_transcript) ? 'transcriptStats' : 'transcript');
  }

  return steps;
};
