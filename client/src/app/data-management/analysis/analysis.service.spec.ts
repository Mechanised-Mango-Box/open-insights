import { describe, expect, it } from 'vitest';
import {
  DatasetState,
  SceneStats,
  TranscriptStats,
  YoutubeContent,
} from '../video-records/Dataset';
import { VideoFile, VideoRecord } from '../video-records/VideoRecord';
import { AnalysisService, buildVideoFeatures } from './analysis.service';

const ready = <T>(data: T): DatasetState<T> => ({ state: 'ready', data, producer: 'test' });

/** Ten minutes, 1500 words, 30 scenes - round numbers so the per-minute rates
 * below are checkable by eye. No YouTube data, like a video not yet published. */
const record = (overrides: Partial<VideoRecord> = {}): VideoRecord => ({
  sort_name: 'A Video',
  video_file: { ...VideoFile.createEmpty(), hash: 'abcd1234', duration_secs: 600 },
  ds_youtubeContent: null,
  ds_youtubeAudienceRetention: null,
  ds_transcript: { state: 'absent' },
  ds_transcriptStats: ready<TranscriptStats>({
    count_chars: 9000,
    count_words: 1500,
    speech_pace_variation: 25,
    speaking_ratio: 0.7,
  }),
  ds_sceneStats: ready<SceneStats>({ duration_secs: 600, scenes: 30 }),
  ...overrides,
});

describe('buildVideoFeatures', () => {
  it('works in minutes, the units the server model was trained on, without YouTube data', () => {
    expect(buildVideoFeatures(record())).toEqual({
      duration: 10,
      wpm: 150,
      scene_change_rate: 3,
      word_count: 1500,
      speech_pace_variation: 25,
      speaking_ratio: 0.7,
    });
  });

  it('is null until both Scan datasets are ready', () => {
    expect(buildVideoFeatures(record({ ds_sceneStats: { state: 'running' } }))).toBeNull();
    expect(
      buildVideoFeatures(record({ ds_transcriptStats: { state: 'failed', error: 'boom' } })),
    ).toBeNull();
  });

  it('is null for a zero duration rather than dividing by it', () => {
    expect(
      buildVideoFeatures(record({ ds_sceneStats: ready({ duration_secs: 0, scenes: 0 }) })),
    ).toBeNull();
  });

  it('is null when the speech features could not be computed, rather than reading as 0', () => {
    const stats = ready<TranscriptStats>({
      count_chars: 9000,
      count_words: 1500,
      speech_pace_variation: null,
      speaking_ratio: null,
    });
    expect(buildVideoFeatures(record({ ds_transcriptStats: stats }))).toBeNull();
  });
});

describe('AnalysisService.buildFeatureRows', () => {
  it('adds the target, and so keeps only records that have YouTube data', () => {
    const published = record({
      ds_youtubeContent: { ...YoutubeContent.createEmpty(), average_view_duration_secs: 300 },
    });
    const result = new AnalysisService().buildFeatureRows([published, record()]);

    expect(result).toMatchObject({ eligibleCount: 1, totalCount: 2 });
    expect(result.rows[0]).toEqual({
      ...buildVideoFeatures(published),
      average_percentage_viewed: 50,
    });
  });
});
