import { describe, expect, it } from 'vitest';
import {
  AudioStats,
  DatasetState,
  SceneStats,
  TextStats,
  Transcript,
  TranscriptStats,
} from '../video-records/Dataset';
import { VideoFile, VideoRecord } from '../video-records/VideoRecord';
import { AnalysisFeatureColumn } from '../analysis/stats';
import { missingScanSteps } from './scan-first';

const ready = <T>(data: T): DatasetState<T> => ({ state: 'ready', data, producer: 'test' });

const completeStats: TranscriptStats = {
  count_chars: 9000,
  count_words: 1500,
  speech_pace_variation: 25,
};

/** Fully scanned by default; each spec takes away what it is about. */
const record = (overrides: Partial<VideoRecord> = {}): VideoRecord => ({
  sort_name: 'A Video',
  video_file: { ...VideoFile.createEmpty(), hash: 'abcd1234', duration_secs: 600 },
  ds_youtubeContent: null,
  ds_youtubeAudienceRetention: null,
  ds_transcript: ready<Transcript>({ segments: [] }),
  ds_transcriptStats: ready(completeStats),
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

describe('missingScanSteps', () => {
  it('is empty for a fully scanned video', () => {
    expect(missingScanSteps(record())).toEqual([]);
  });

  it('runs scene stats before the transcript, since the speech features need the duration', () => {
    expect(
      missingScanSteps(
        record({
          ds_sceneStats: { state: 'absent' },
          ds_transcript: { state: 'absent' },
          ds_transcriptStats: { state: 'absent' },
        }),
      ),
    ).toEqual(['sceneStats', 'transcript']);
  });

  it('recomputes stats locally rather than refetching a transcript it already holds', () => {
    const incomplete = ready<TranscriptStats>({
      ...completeStats,
      speech_pace_variation: null,
    });
    expect(missingScanSteps(record({ ds_transcriptStats: incomplete }))).toEqual([
      'transcriptStats',
    ]);
  });

  it('reads the screen text last, after the steps the speech features depend on', () => {
    expect(
      missingScanSteps(
        record({
          ds_sceneStats: { state: 'absent' },
          ds_textStats: { state: 'failed', error: 'boom' },
        }),
      ),
    ).toEqual(['sceneStats', 'textStats']);
  });

  it('scans the audio again when it was scanned before speech and pauses were measured', () => {
    const { speech_ratio, pause_rate_per_min, mean_pause_secs, ...old } = AudioStats.createEmpty();
    expect(missingScanSteps(record({ ds_audioStats: ready<AudioStats>(old) }))).toEqual([
      'audioStats',
    ]);
    expect(missingScanSteps(record({ ds_audioStats: { state: 'absent' } }))).toEqual([
      'audioStats',
    ]);
  });

  it('treats a failed or zero-length scene scan as still missing', () => {
    expect(missingScanSteps(record({ ds_sceneStats: { state: 'failed', error: 'boom' } }))).toEqual(
      ['sceneStats'],
    );
    expect(
      missingScanSteps(record({ ds_sceneStats: ready({ duration_secs: 0, scenes: 0 }) })),
    ).toEqual(['sceneStats']);
  });
});

describe('missingScanSteps for a model that uses fewer features', () => {
  const audioOnly: AnalysisFeatureColumn[] = [
    'duration',
    'wpm',
    'word_count',
    'speech_pace_variation',
    'speech_ratio',
    'mean_pause_secs',
  ];
  const bare = record({
    ds_transcript: { state: 'absent' },
    ds_transcriptStats: { state: 'absent' },
    ds_sceneStats: { state: 'absent' },
    ds_textStats: { state: 'absent' },
    ds_audioStats: { state: 'absent' },
  });

  it('asks only for the scans its features come from', () => {
    expect(missingScanSteps(bare, ['duration', 'scene_change_rate', 'text_density'])).toEqual([
      'sceneStats',
      'textStats',
    ]);
  });

  it('runs audio stats first when they carry the duration, and never scene stats', () => {
    expect(missingScanSteps(bare, audioOnly)).toEqual(['audioStats', 'transcript']);
  });

  it('leaves out on-screen text for the fast set', () => {
    const fast = audioOnly.concat('scene_change_rate');
    expect(missingScanSteps(bare, fast)).toEqual(['sceneStats', 'transcript', 'audioStats']);
  });
});
