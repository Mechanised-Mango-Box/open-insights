import { Injectable } from '@angular/core';
import { readyData } from '../video-records/Dataset';
import { VideoRecord } from '../video-records/VideoRecord';
import {
  ANALYSIS_FEATURE_COLUMNS,
  AnalysisFeatureColumn,
  AnalysisFeatureRow,
  durationSourceFor,
} from './stats';

export type FeatureRowResult = {
  rows: AnalysisFeatureRow[];
  eligibleCount: number;
  totalCount: number;
  /** Why the other records were left out, by reason, most common first. */
  skipped: { reason: string; count: number }[];
};

/** One video's model inputs: an AnalysisFeatureRow without its target. */
export type VideoFeatures = Pick<AnalysisFeatureRow, AnalysisFeatureColumn>;

type FeatureOutcome =
  | { ok: true; features: Partial<VideoFeatures>; durationSecs: number }
  | { ok: false; reason: string };

/**
 * The named features of one record, or why they cannot be computed. The one place
 * the features are derived, for every feature set: the Analysis page asks for all
 * of them, the Recommend page for whichever the chosen model uses.
 *
 * Only the Scan results `columns` come from are required. Duration comes from
 * scene stats when the set includes a scene feature, and from audio stats
 * otherwise (durationSourceFor) - exactly as the server's training reads an
 * export (data_preparation.py), because the server scores what this sends.
 */
const computeFeatures = (
  record: VideoRecord,
  columns: readonly AnalysisFeatureColumn[],
): FeatureOutcome => {
  const needs = (...names: AnalysisFeatureColumn[]) => names.some((n) => columns.includes(n));
  const durationSource = durationSourceFor(columns);

  // readyData() is null unless the value is actually held, so a queued or
  // failed dataset drops out exactly as a missing one does.
  const sceneStats = readyData(record.ds_sceneStats);
  const transcriptStats = readyData(record.ds_transcriptStats);
  const textStats = readyData(record.ds_textStats);
  const audioStats = readyData(record.ds_audioStats);

  if ((durationSource === 'sceneStats' || needs('scene_change_rate')) && !sceneStats)
    return { ok: false, reason: 'no scene stats' };
  if (needs('wpm', 'word_count', 'speech_pace_variation') && !transcriptStats)
    return { ok: false, reason: 'no transcript stats' };
  if (needs('text_density') && !textStats) return { ok: false, reason: 'no screen text' };
  if ((durationSource === 'audioStats' || needs('speech_ratio', 'mean_pause_secs')) && !audioStats)
    return { ok: false, reason: 'no audio stats' };

  const durationSecs =
    durationSource === 'sceneStats' ? sceneStats!.duration_secs : audioStats!.duration_secs;
  if (!(durationSecs > 0)) return { ok: false, reason: 'no positive duration' };

  // Scan computes these; null means it had no duration to measure against.
  // Dropping the record is the point of the null - feeding the 0 the speech
  // functions return for missing input would read as a real measurement, and
  // these numbers drive written recommendations.
  if (needs('speech_pace_variation') && transcriptStats!.speech_pace_variation == null)
    return { ok: false, reason: 'speech pace not measured' };
  // Missing from audio scanned before speech and pauses were measured, and
  // mean_pause_secs is null for a video with fewer than two stretches of speech
  // - no pause to average, which is no reason to invent one.
  if (needs('speech_ratio') && audioStats!.speech_ratio == null)
    return { ok: false, reason: 'audio scanned before speech was measured' };
  if (needs('mean_pause_secs') && audioStats!.mean_pause_secs == null)
    return { ok: false, reason: 'no pause to measure' };

  const durationMins = durationSecs / 60;
  const compute: Record<AnalysisFeatureColumn, () => number> = {
    duration: () => durationMins,
    wpm: () => transcriptStats!.count_words / durationMins,
    scene_change_rate: () => sceneStats!.scenes / durationMins,
    word_count: () => transcriptStats!.count_words,
    speech_pace_variation: () => transcriptStats!.speech_pace_variation!,
    // From the audio, not the transcript's speaking_ratio: Whisper's segments
    // run across pauses, so that one sat near 1 for nearly every video.
    speech_ratio: () => audioStats!.speech_ratio!,
    text_density: () => textStats!.mean_words,
    mean_pause_secs: () => audioStats!.mean_pause_secs!,
  };
  const features: Partial<VideoFeatures> = {};
  for (const column of columns) features[column] = compute[column]();
  return { ok: true, features, durationSecs };
};

/**
 * The named features of one record, or null when its Scan results cannot supply
 * them. A video being assessed before it is published has no YouTube data, and
 * needs none to be scored.
 */
export const buildFeaturesFor = (
  record: VideoRecord,
  columns: readonly AnalysisFeatureColumn[],
): Partial<VideoFeatures> | null => {
  const outcome = computeFeatures(record, columns);
  return outcome.ok ? outcome.features : null;
};

/** Why buildFeaturesFor() would return null for this record, or null if it would not. */
export const featureSkipReason = (
  record: VideoRecord,
  columns: readonly AnalysisFeatureColumn[] = ANALYSIS_FEATURE_COLUMNS,
): string | null => {
  const outcome = computeFeatures(record, columns);
  return outcome.ok ? null : outcome.reason;
};

/**
 * Every feature the Analysis page fits and the full engagement model scores, or
 * null when the record's Scan results cannot supply them.
 *
 * A plain function rather than a service method so it can be tested without an
 * injector.
 */
export const buildVideoFeatures = (record: VideoRecord): VideoFeatures | null =>
  buildFeaturesFor(record, ANALYSIS_FEATURE_COLUMNS) as VideoFeatures | null;

@Injectable({
  providedIn: 'root',
})
export class AnalysisService {
  buildFeatureRows(records: VideoRecord[]): FeatureRowResult {
    const rows: AnalysisFeatureRow[] = [];
    const skipped = new Map<string, number>();
    const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

    for (const record of records) {
      const outcome = computeFeatures(record, ANALYSIS_FEATURE_COLUMNS);
      if (!outcome.ok) {
        skip(outcome.reason);
        continue;
      }
      const avgViewDurationSecs = record.ds_youtubeContent?.average_view_duration_secs;
      if (avgViewDurationSecs == null) {
        skip('no YouTube average view duration');
        continue;
      }

      // The duration the features were divided by, in seconds, rather than
      // recovered from features.duration - so the target is not put through a
      // minutes round trip the analysis goldens never saw.
      rows.push({
        ...(outcome.features as VideoFeatures),
        average_percentage_viewed: (avgViewDurationSecs / outcome.durationSecs) * 100,
      });
    }

    return {
      rows,
      eligibleCount: rows.length,
      totalCount: records.length,
      skipped: [...skipped.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
