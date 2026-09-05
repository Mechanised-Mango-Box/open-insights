import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DatasetState, LOCAL_IMPORT, SceneStats, Transcript, YoutubeContent } from './Dataset';
import { VideoFile, VideoRecord } from './VideoRecord';
import { buildExportZip, ExportManifest } from './manifest-export';
import { fillGaps, parseExportZip } from './manifest-import';

const HASH = 'abcd1234';

const transcript: Transcript = {
  segments: [
    { start: 1.25, end: 4.5, text: 'Welcome back to the channel.' },
    // Past an hour and with a fractional end, to cover what the old "[MM:SS]" format
    // could not represent at all.
    { start: 3675.5, end: 3680.125, text: 'And that is the whole thing.' },
  ],
};

const ready = <T>(data: T): DatasetState<T> => ({
  state: 'ready',
  data,
  producer: 'test',
  produced_at: '2026-01-01T00:00:00.000Z',
});

const record = (overrides: Partial<VideoRecord> = {}): VideoRecord => ({
  sort_name: 'A Video',
  // duration_secs is set, so nothing in these specs reaches readFileDurationSecs - it
  // builds a <video> element, and jsdom fires neither loadedmetadata nor error, so a spec
  // that entered that branch would hang rather than fail.
  video_file: { ...VideoFile.createEmpty(), hash: HASH, duration_secs: 3700 },
  ds_youtubeContent: { ...YoutubeContent.createEmpty(), content: 'yt-id-1', views: 900 },
  ds_youtubeAudienceRetention: { video_position: [0, 0.5], absolute_audience_retention: [1, 0.4] },
  ds_transcript: ready(transcript),
  ds_transcriptStats: ready({ count_chars: 56, count_words: 11 }),
  ds_sceneStats: ready<SceneStats>({ duration_secs: 3700, scenes: 42 }),
  ...overrides,
});

/** Round-trips records through the real export, as a file the way an <input> hands one over. */
const roundTrip = async (records: VideoRecord[]) => {
  const blob = await buildExportZip(records, { includeVideoFiles: false });
  return parseExportZip(new File([blob], 'export.zip', { type: 'application/zip' }));
};

describe('parseExportZip', () => {
  it('restores everything the export wrote, transcript end times included', async () => {
    const [imported] = await roundTrip([record()]);

    expect(imported.sort_name).toBe('A Video');
    expect(imported.video_file.hash).toBe(HASH);
    expect(imported.video_file.duration_secs).toBe(3700);
    expect(imported.ds_youtubeContent).toEqual(record().ds_youtubeContent);
    expect(imported.ds_youtubeAudienceRetention).toEqual(record().ds_youtubeAudienceRetention);

    // The point of exporting SRT rather than "[MM:SS] text": ends and milliseconds survive.
    expect(imported.ds_transcript).toMatchObject({ state: 'ready', data: transcript });
    expect(imported.ds_transcriptStats).toMatchObject({
      state: 'ready',
      data: { count_chars: 56, count_words: 11 },
    });
    expect(imported.ds_sceneStats).toMatchObject({
      state: 'ready',
      data: { duration_secs: 3700, scenes: 42 },
    });
  });

  it('stamps restored data as a local import, dated by the export', async () => {
    const [imported] = await roundTrip([record()]);

    expect(imported.ds_transcript).toMatchObject({ producer: LOCAL_IMPORT });
    expect((imported.ds_transcript as { produced_at: string }).produced_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });

  it('leaves datasets the export had nothing for absent', async () => {
    const [imported] = await roundTrip([
      record({
        ds_youtubeContent: null,
        ds_youtubeAudienceRetention: null,
        ds_transcript: { state: 'failed', error: 'whisper fell over' },
        ds_transcriptStats: { state: 'absent' },
        ds_sceneStats: { state: 'queued' },
      }),
    ]);

    expect(imported.ds_youtubeContent).toBeNull();
    expect(imported.ds_youtubeAudienceRetention).toBeNull();
    expect(imported.ds_transcript).toEqual({ state: 'absent' });
    expect(imported.ds_transcriptStats).toEqual({ state: 'absent' });
    expect(imported.ds_sceneStats).toEqual({ state: 'absent' });
  });

  it('imports a record that never had a video file', async () => {
    const [imported] = await roundTrip([
      record({ video_file: VideoFile.createEmpty(), ds_transcript: { state: 'absent' } }),
    ]);

    expect(imported.video_file.hash).toBe('');
    expect(imported.video_file.duration_secs).toBeNull();
    expect(imported.ds_youtubeContent?.content).toBe('yt-id-1');
  });

  it('rejects a zip that is not an export', async () => {
    const zip = new JSZip();
    zip.file('notes.txt', 'nothing to see');
    const blob = await zip.generateAsync({ type: 'blob' });

    await expect(parseExportZip(blob)).rejects.toThrow('manifest.json is missing');
  });

  it('still reads the pre-SRT "[MM:SS] text" transcripts, ending each where the next starts', async () => {
    const manifest: ExportManifest = {
      generated_at: '2025-01-01T00:00:00.000Z',
      records: [
        {
          id: HASH,
          sort_name: 'Legacy Export',
          video_file: { hash: HASH, exists_on_server: false, duration_secs: null },
          youtube_content: null,
          transcript_stats: null,
          scene_stats: null,
          transcript_path: `transcript/${HASH}.txt`,
          video_file_path: null,
          audience_retention_path: null,
        },
      ],
    };
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file(`transcript/${HASH}.txt`, '[00:05] First line.\n[75:30] Past an hour.');

    const [imported] = await parseExportZip(await zip.generateAsync({ type: 'blob' }));

    expect(imported.ds_transcript).toMatchObject({
      state: 'ready',
      data: {
        segments: [
          { start: 5, end: 4530, text: 'First line.' },
          { start: 4530, end: 4530, text: 'Past an hour.' },
        ],
      },
    });
  });
});

describe('fillGaps', () => {
  const existing = (overrides: Partial<VideoRecord> = {}): VideoRecord => ({
    ...record(),
    __id: 7,
    ...overrides,
  });

  it('adds nothing when the existing record already has it all', async () => {
    const [imported] = await roundTrip([record()]);

    expect(fillGaps(existing(), imported)).toBeNull();
  });

  it('keeps a ready transcript rather than taking the imported one', async () => {
    const [imported] = await roundTrip([record()]);
    const local = ready<Transcript>({ segments: [{ start: 0, end: 1, text: 'Mine.' }] });

    const merged = fillGaps(existing({ ds_transcript: local }), imported);

    expect(merged).toBeNull();
    expect(existing({ ds_transcript: local }).ds_transcript).toBe(local);
  });

  it('fills a failed dataset, which holds no usable value either', async () => {
    const [imported] = await roundTrip([record()]);

    const merged = fillGaps(
      existing({ ds_transcript: { state: 'failed', error: 'timed out' } }),
      imported,
    );

    expect(merged?.ds_transcript).toMatchObject({ state: 'ready', data: transcript });
  });

  it('fills a missing youtube report and duration, and never the name or server flag', async () => {
    const [imported] = await roundTrip([record()]);
    const before = existing({
      sort_name: 'Renamed Locally',
      video_file: { ...VideoFile.createEmpty(), hash: HASH, exists_on_server: true },
      ds_youtubeContent: null,
    });

    const merged = fillGaps(before, imported);

    expect(merged?.ds_youtubeContent?.content).toBe('yt-id-1');
    expect(merged?.video_file.duration_secs).toBe(3700);
    expect(merged?.sort_name).toBe('Renamed Locally');
    expect(merged?.video_file.exists_on_server).toBe(true);
    // The caller writes the result back by __id, so it has to survive the merge.
    expect(merged?.__id).toBe(7);
  });

  it('takes the hash along with the file, for a record matched on its youtube id', async () => {
    const [imported] = await roundTrip([record()]);
    const before = existing({ video_file: VideoFile.createEmpty() });

    const merged = fillGaps(before, imported);

    expect(merged?.video_file.hash).toBe(HASH);
  });

  it('does not mutate the record handed to it', async () => {
    const [imported] = await roundTrip([record()]);
    const before = existing({ ds_youtubeContent: null });

    fillGaps(before, imported);

    expect(before.ds_youtubeContent).toBeNull();
  });
});
