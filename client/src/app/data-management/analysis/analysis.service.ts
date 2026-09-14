import { Injectable } from '@angular/core';
import { readyData } from '../video-records/Dataset';
import { VideoRecord } from '../video-records/VideoRecord';
import { AnalysisFeatureColumn, AnalysisFeatureRow } from './stats';

export type FeatureRowResult = {
  rows: AnalysisFeatureRow[];
  eligibleCount: number;
  totalCount: number;
};

/** One video's model inputs: an AnalysisFeatureRow without its target. */
export type VideoFeatures = Pick<AnalysisFeatureRow, AnalysisFeatureColumn>;

/**
 * The six features the Analysis page fits and the server's engagement model
 * scores, or null when the record's Scan results cannot supply them.
 *
 * Kept apart from the target so the Recommend page can use it too: a video
 * being assessed before it is published has no YouTube data, and needs none to
 * be scored. A plain function rather than a service method so it can be tested
 * without an injector.
 */
export const buildVideoFeatures = (record: VideoRecord): VideoFeatures | null => {
  // readyData() is null unless the value is actually held, so a queued or
  // failed dataset drops out exactly as a missing one does.
  const sceneStats = readyData(record.ds_sceneStats);
  const transcriptStats = readyData(record.ds_transcriptStats);

  if (!sceneStats || !transcriptStats) return null;
  if (sceneStats.duration_secs <= 0) return null;
  // Scan computes these; null means it had no duration to measure against.
  // Dropping the record is the point of the null - feeding the 0 the speech
  // functions return for missing input would read as a real measurement, and
  // these numbers drive written recommendations.
  if (transcriptStats.speech_pace_variation == null || transcriptStats.speaking_ratio == null)
    return null;

  const duration_mins = sceneStats.duration_secs / 60;
  return {
    duration: duration_mins,
    wpm: transcriptStats.count_words / duration_mins,
    scene_change_rate: sceneStats.scenes / duration_mins,
    word_count: transcriptStats.count_words,
    speech_pace_variation: transcriptStats.speech_pace_variation,
    speaking_ratio: transcriptStats.speaking_ratio,
  };
};

@Injectable({
  providedIn: 'root',
})
export class AnalysisService {
  buildFeatureRows(records: VideoRecord[]): FeatureRowResult {
    const rows: AnalysisFeatureRow[] = [];

    for (const record of records) {
      const features = buildVideoFeatures(record);
      const avgViewDurationSecs = record.ds_youtubeContent?.average_view_duration_secs;
      if (!features || avgViewDurationSecs == null) continue;

      // Ready, or buildVideoFeatures() would have returned null. Read back
      // rather than recovered from features.duration, so the target is not
      // put through a minutes round trip the analysis goldens never saw.
      const durationSecs = readyData(record.ds_sceneStats)!.duration_secs;
      rows.push({
        ...features,
        average_percentage_viewed: (avgViewDurationSecs / durationSecs) * 100,
      });
    }

    return { rows, eligibleCount: rows.length, totalCount: records.length };
  }
}
