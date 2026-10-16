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
import { buildTrainingManifest } from '../video-records/manifest-export';
import {
  MODEL_ID_PATTERN,
  describeTrainError,
  matchingPreset,
  slugify,
  trainableCount,
} from './create-model';
import { ANALYSIS_FEATURE_COLUMNS, FEATURE_PRESETS } from './stats';

const ready = <T>(data: T): DatasetState<T> => ({ state: 'ready', data, producer: 'test' });

/** Ten minutes, fully scanned, watched for six on average. */
const record = (overrides: Partial<VideoRecord> = {}): VideoRecord => ({
  sort_name: 'A private title',
  video_file: { ...VideoFile.createEmpty(), hash: 'abcd1234', duration_secs: 600 },
  ds_youtubeContent: {
    ...YoutubeContent.createEmpty(),
    content: 'A private title',
    views: 1234,
    average_view_duration_secs: 360,
  },
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

describe('FEATURE_PRESETS', () => {
  it("matches the server's FEATURE_SETS, set for set", () => {
    // Copied from server/model_training/data_preparation.py: a model trained on
    // a preset must be the one the server would train on that set.
    expect(FEATURE_PRESETS).toEqual({
      all: [...ANALYSIS_FEATURE_COLUMNS],
      lite: ['duration', 'wpm', 'speech_pace_variation', 'mean_pause_secs'],
      video: ['duration', 'scene_change_rate', 'text_density'],
      audio: [
        'duration',
        'wpm',
        'word_count',
        'speech_pace_variation',
        'speech_ratio',
        'mean_pause_secs',
      ],
    });
  });
});

describe('matchingPreset', () => {
  it('names the preset the chosen features add up to, in any order', () => {
    expect(matchingPreset(['mean_pause_secs', 'duration', 'speech_pace_variation', 'wpm'])).toBe(
      'lite',
    );
    expect(matchingPreset([...ANALYSIS_FEATURE_COLUMNS])).toBe('all');
  });

  it('is null for a set of their own', () => {
    expect(matchingPreset(['duration', 'wpm'])).toBeNull();
    expect(matchingPreset([])).toBeNull();
  });
});

describe('trainableCount', () => {
  it('counts only records with every scan the features need and a view duration', () => {
    const records = [
      record(),
      record({ ds_youtubeContent: null }),
      record({ ds_youtubeContent: { ...YoutubeContent.createEmpty() } }),
      record({ ds_sceneStats: { state: 'absent' } }),
      record({ ds_textStats: { state: 'absent' } }),
    ];
    expect(trainableCount(records, FEATURE_PRESETS.all)).toBe(1);
    // Lite reads its duration from audio stats, so neither missing scan matters.
    expect(trainableCount(records, FEATURE_PRESETS.lite)).toBe(3);
    // A hand-picked set needs only its own scans.
    expect(trainableCount(records, ['duration', 'text_density'])).toBe(2);
  });
});

describe('slugify', () => {
  it('makes an id the server accepts from a name', () => {
    for (const [name, id] of [
      ['My Lectures (2026)', 'my-lectures-2026'],
      ['  Café Talks  ', 'cafe-talks'],
      ['ENGG2440_lite', 'engg2440-lite'],
      ['!!!', ''],
    ]) {
      expect(slugify(name)).toBe(id);
      if (id) expect(MODEL_ID_PATTERN.test(id)).toBe(true);
    }
    const long = slugify('a '.repeat(100));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(MODEL_ID_PATTERN.test(long)).toBe(true);
  });
});

describe('describeTrainError', () => {
  it("passes on the server's reason", () => {
    const error = { status: 409, error: { err: "A model with id 'lite' is already here." } };
    expect(describeTrainError(error)).toBe("A model with id 'lite' is already here.");
  });

  it('explains a rate limit or a full server rather than echoing it', () => {
    expect(describeTrainError({ status: 429, error: {} })).toContain('limit on new models');
    expect(describeTrainError({ status: 503, error: { err: 'full' } })).toContain('own server');
  });
});

describe('buildTrainingManifest', () => {
  it('sends the Scan results and view duration, and nothing that names the video', () => {
    const manifest = buildTrainingManifest([record(), record({ ds_youtubeContent: null })]);
    expect(manifest.records[0]).toEqual({
      id: 'record-0',
      youtube_content: { average_view_duration_secs: 360 },
      transcript_stats: { count_chars: 9000, count_words: 1500, speech_pace_variation: 25 },
      scene_stats: { duration_secs: 600, scenes: 30 },
      text_stats: {
        sample_count: 120,
        mean_words: 35,
        max_words: 80,
        mean_coverage: 0.12,
        text_frames_ratio: 0.9,
      },
      audio_stats: expect.objectContaining({ speech_ratio: 0.9, mean_pause_secs: 0.35 }),
    });
    expect(manifest.records[1].youtube_content).toBeNull();
    const sent = JSON.stringify(manifest);
    expect(sent).not.toContain('A private title');
    expect(sent).not.toContain('abcd1234');
  });
});
