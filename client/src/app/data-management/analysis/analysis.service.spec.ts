import { describe, expect, it } from 'vitest';
import {
  AudioStats,
  DatasetState,
  SceneStats,
  TextStats,
  TranscriptStats,
  YoutubeContent,
} from '../video-records/Dataset';
import { VideoFile, VideoRecord } from '../video-records/VideoRecord';
import {
  AnalysisService,
  buildFeaturesFor,
  buildVideoFeatures,
  featureSkipReason,
} from './analysis.service';
import { ANALYSIS_FEATURE_COLUMNS } from './stats';

const ready = <T>(data: T): DatasetState<T> => ({ state: 'ready', data, producer: 'test' });

/** Ten minutes, 1500 words, 30 scenes, 35 words on screen, speech 90% of the time
 * with 0.35 s pauses - round numbers so the per-minute rates below are checkable by
 * eye. No YouTube data, like a video not
 * yet published. */
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
  }),
  ds_sceneStats: ready<SceneStats>({ duration_secs: 600, scenes: 30 }),
  ds_textStats: ready<TextStats>({
    sample_count: 120,
    mean_words: 35,
    max_words: 80,
    mean_coverage: 0.12,
    text_frames_ratio: 0.9,
  }),
  ds_audioStats: ready<AudioStats>({
    duration_secs: 600,
    speech_secs: 560,
    speech_level_db: -24,
    background_sound_ratio: 0.01,
    median_pitch_hz: 150,
    pitch_variation_st: 3.5,
    speech_ratio: 0.9,
    pause_rate_per_min: 4,
    mean_pause_secs: 0.35,
  }),
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
      speech_ratio: 0.9,
      text_density: 35,
      mean_pause_secs: 0.35,
    });
  });

  it('is null until every Scan dataset is ready', () => {
    expect(buildVideoFeatures(record({ ds_sceneStats: { state: 'running' } }))).toBeNull();
    expect(
      buildVideoFeatures(record({ ds_transcriptStats: { state: 'failed', error: 'boom' } })),
    ).toBeNull();
    expect(buildVideoFeatures(record({ ds_textStats: { state: 'absent' } }))).toBeNull();
    expect(buildVideoFeatures(record({ ds_audioStats: { state: 'queued' } }))).toBeNull();
  });

  it('is null for audio scanned before speech and pauses were measured', () => {
    const { speech_ratio, pause_rate_per_min, mean_pause_secs, ...old } = AudioStats.createEmpty();
    expect(buildVideoFeatures(record({ ds_audioStats: ready<AudioStats>(old) }))).toBeNull();
  });

  it('is null with no pause to average, rather than inventing one', () => {
    const stats = { ...AudioStats.createEmpty(), speech_ratio: 1, mean_pause_secs: null };
    expect(buildVideoFeatures(record({ ds_audioStats: ready<AudioStats>(stats) }))).toBeNull();
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

describe('buildFeaturesFor', () => {
  it('computes only the named features, reading duration from audio when there is no scene feature', () => {
    const noScene = record({
      ds_sceneStats: { state: 'absent' },
      ds_textStats: { state: 'absent' },
      ds_audioStats: ready<AudioStats>({
        duration_secs: 480,
        speech_secs: 400,
        speech_level_db: -24,
        background_sound_ratio: 0.01,
        median_pitch_hz: 150,
        pitch_variation_st: 3.5,
        speech_ratio: 0.8,
        pause_rate_per_min: 4,
        mean_pause_secs: 0.4,
      }),
    });
    expect(buildFeaturesFor(noScene, ['duration', 'wpm', 'speech_ratio'])).toEqual({
      duration: 8,
      wpm: 187.5,
      speech_ratio: 0.8,
    });
    expect(buildVideoFeatures(noScene)).toBeNull();
  });

  it('agrees with buildVideoFeatures for the full set', () => {
    expect(buildFeaturesFor(record(), ANALYSIS_FEATURE_COLUMNS)).toEqual(
      buildVideoFeatures(record()),
    );
  });
});

describe('AnalysisService.buildFeatureRows skip reasons', () => {
  it('says why each left-out record was left out, most common first', () => {
    const published = (overrides: Partial<VideoRecord>) =>
      record({
        ds_youtubeContent: { ...YoutubeContent.createEmpty(), average_view_duration_secs: 300 },
        ...overrides,
      });
    const result = new AnalysisService().buildFeatureRows([
      published({}),
      published({ ds_textStats: { state: 'absent' } }),
      published({ ds_textStats: { state: 'failed', error: 'x' } }),
      record(),
    ]);
    expect(result.eligibleCount).toBe(1);
    expect(result.skipped).toEqual([
      { reason: 'no screen text', count: 2 },
      { reason: 'no YouTube average view duration', count: 1 },
    ]);
    expect(featureSkipReason(record({ ds_sceneStats: { state: 'absent' } }))).toBe(
      'no scene stats',
    );
  });
});
