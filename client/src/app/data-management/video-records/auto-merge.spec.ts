import { describe, expect, it } from 'vitest';
import { DatasetState, Transcript, YoutubeContent } from './Dataset';
import { VideoFile, VideoRecord } from './VideoRecord';
import { findAutoMergePairs, mergePair, normalizeTitle, titleSimilarity } from './auto-merge';

const base = (): Omit<VideoRecord, 'sort_name'> => ({
  video_file: VideoFile.createEmpty(),
  ds_youtubeContent: null,
  ds_youtubeAudienceRetention: null,
  ds_transcript: { state: 'absent' },
  ds_transcriptStats: { state: 'absent' },
  ds_sceneStats: { state: 'absent' },
});

const youtubeRow = (title: string, duration_secs: number | null, id = title): VideoRecord => ({
  ...base(),
  sort_name: title,
  ds_youtubeContent: { ...YoutubeContent.createEmpty(), content: id, duration_secs },
});

// duration_secs is always stored so nothing here reaches readFileDurationSecs.
const fileRow = (name: string, duration_secs: number | null, hash = name): VideoRecord => ({
  ...base(),
  sort_name: name,
  video_file: { ...VideoFile.createEmpty(), hash, duration_secs },
});

const readyTranscript = (text: string): DatasetState<Transcript> => ({
  state: 'ready',
  data: { segments: [{ start: 0, end: 1, text }] },
  producer: 'test',
  produced_at: '2026-01-01T00:00:00.000Z',
});

describe('normalizeTitle', () => {
  it('drops the extension, a trailing video id, case, accents and punctuation', () => {
    expect(normalizeTitle('Café_Tour - Part 2 [dQw4w9WgXcQ].mp4')).toBe('cafe tour part 2');
  });
});

describe('titleSimilarity', () => {
  it('is 1 for a title and its file name', () => {
    expect(titleSimilarity('My Video Title', 'my_video_title.mp4')).toBe(1);
  });

  it('is partial for overlapping words', () => {
    expect(titleSimilarity('Intro to ML', 'Intro to Deep Learning')).toBeCloseTo(4 / 7);
  });
});

describe('findAutoMergePairs', () => {
  it('pairs a title with its file when the durations agree', () => {
    const yt = youtubeRow('My Video Title', 212);
    const file = fileRow('My Video Title.mp4', 212.4);

    const { pairs, unmatched } = findAutoMergePairs([yt, file]);

    expect(pairs).toEqual([{ youtube: yt, file, similarity: 1, durationMatched: true }]);
    expect(unmatched).toBe(0);
  });

  it('does not pair the same title when the durations differ', () => {
    const { pairs, unmatched } = findAutoMergePairs([
      youtubeRow('My Video Title', 212),
      fileRow('My Video Title.mp4', 242),
    ]);
    expect(pairs).toEqual([]);
    expect(unmatched).toBe(2);
  });

  it('pairs on a near-identical title alone when a duration is missing', () => {
    const { pairs } = findAutoMergePairs([
      youtubeRow('My Video Title', null),
      fileRow('my-video-title.mkv', 212),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].durationMatched).toBe(false);
  });

  it('needs more than a loose title match when there is no duration', () => {
    const { pairs } = findAutoMergePairs([
      youtubeRow('Intro to ML', null),
      fileRow('Intro to Deep Learning.mp4', null),
    ]);
    expect(pairs).toEqual([]);
  });

  it('accepts a looser title when the duration confirms it', () => {
    const { pairs } = findAutoMergePairs([
      youtubeRow('Intro to ML | Full Course', 600),
      fileRow('intro to ml.mp4', 600),
    ]);
    expect(pairs).toHaveLength(1);
  });

  it('picks the best candidate for each record', () => {
    const yt = youtubeRow('Cooking Pasta', 300);
    const close = fileRow('Cooking Pasta.mp4', 300);
    const looser = fileRow('Cooking Pasta Again.mp4', 301);

    const { pairs } = findAutoMergePairs([yt, looser, close]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].file).toBe(close);
  });

  it('leaves a record alone when two candidates tie', () => {
    const yt = youtubeRow('Weekly Update', 120);
    const { pairs } = findAutoMergePairs([
      yt,
      fileRow('Weekly Update.mp4', 120, 'h1'),
      fileRow('Weekly Update.mov', 120, 'h2'),
    ]);
    expect(pairs).toEqual([]);
  });

  it('ignores records that already have both halves', () => {
    const complete: VideoRecord = {
      ...fileRow('My Video Title.mp4', 212),
      ds_youtubeContent: { ...YoutubeContent.createEmpty(), duration_secs: 212 },
    };
    const { pairs, unmatched } = findAutoMergePairs([complete, youtubeRow('My Video Title', 212)]);
    expect(pairs).toEqual([]);
    expect(unmatched).toBe(1);
  });
});

describe('mergePair', () => {
  it('keeps the YouTube title, the file and the YouTube data', () => {
    const yt = youtubeRow('My Video Title', 212, 'yt-id');
    const file = fileRow('My Video Title.mp4', 212, 'abc123');
    const [pair] = findAutoMergePairs([yt, file]).pairs;

    const merged = mergePair(pair)!;

    expect(merged.sort_name).toBe('My Video Title');
    expect(merged.video_file.hash).toBe('abc123');
    expect(merged.ds_youtubeContent?.content).toBe('yt-id');
  });

  it('refuses a pair that disagrees on more than the name', () => {
    const yt = { ...youtubeRow('My Video Title', 212), ds_transcript: readyTranscript('one') };
    const file = { ...fileRow('My Video Title.mp4', 212), ds_transcript: readyTranscript('two') };

    expect(mergePair({ youtube: yt, file, similarity: 1, durationMatched: true })).toBeNull();
  });
});
