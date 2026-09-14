import { describe, expect, it } from 'vitest';
import { DatasetState, SceneStats, Transcript, TranscriptStats } from '../video-records/Dataset';
import { VideoFile, VideoRecord } from '../video-records/VideoRecord';
import { missingScanSteps } from './scan-first';

const ready = <T>(data: T): DatasetState<T> => ({ state: 'ready', data, producer: 'test' });

const completeStats: TranscriptStats = {
  count_chars: 9000,
  count_words: 1500,
  speech_pace_variation: 25,
  speaking_ratio: 0.7,
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
      speaking_ratio: null,
    });
    expect(missingScanSteps(record({ ds_transcriptStats: incomplete }))).toEqual([
      'transcriptStats',
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
