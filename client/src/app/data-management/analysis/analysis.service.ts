import { Injectable } from '@angular/core';
import { readyData } from '../video-records/Dataset';
import { VideoRecord } from '../video-records/VideoRecord';
import { calculateSpeakingRatio, calculateSpeechPaceVariation } from './speech-features';
import { AnalysisFeatureRow } from './stats';

export type FeatureRowResult = {
  rows: AnalysisFeatureRow[];
  eligibleCount: number;
  totalCount: number;
};

@Injectable({
  providedIn: 'root',
})
export class AnalysisService {
  buildFeatureRows(records: VideoRecord[]): FeatureRowResult {
    const rows: AnalysisFeatureRow[] = [];

    for (const record of records) {
      // readyData() is null unless the value is actually held, so a queued or
      // failed dataset drops out of the analysis exactly as a missing one does.
      const sceneStats = readyData(record.ds_sceneStats);
      const transcriptStats = readyData(record.ds_transcriptStats);
      const transcript = readyData(record.ds_transcript);
      const avgViewDurationSecs = record.ds_youtubeContent?.average_view_duration_secs;

      if (!sceneStats || !transcriptStats || avgViewDurationSecs == null) continue;
      if (sceneStats.duration_secs <= 0) continue;

      const duration_mins = sceneStats.duration_secs / 60;
      rows.push({
        duration: duration_mins,
        wpm: transcriptStats.count_words / duration_mins,
        scene_change_rate: sceneStats.scenes / duration_mins,
        word_count: transcriptStats.count_words,
        speech_pace_variation: calculateSpeechPaceVariation(transcript, sceneStats.duration_secs),
        speaking_ratio: calculateSpeakingRatio(transcript, sceneStats.duration_secs),
        average_percentage_viewed: (avgViewDurationSecs / sceneStats.duration_secs) * 100,
      });
    }

    return { rows, eligibleCount: rows.length, totalCount: records.length };
  }
}
