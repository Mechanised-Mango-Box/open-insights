import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatasetActionsService } from './dataset-actions.service';
import { DatasetKind, DatasetProvider } from '../providers/dataset-provider';
import { ServerConfigService } from '../server-config.service';
import { VideoRecord } from './VideoRecord';

const REFRESH_MS = 5000;

/** Lets every pending microtask chain settle - the checks await a response, then write a signal. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('DatasetActionsService status freshness', () => {
  let provider: {
    label: ReturnType<typeof signal<string>>;
    sourceStatus: ReturnType<typeof vi.fn>;
    peek: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    putSource: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };
  let service: DatasetActionsService;
  let config: ServerConfigService;

  /** peek() is kind-generic, so a per-kind view keeps these assertions readable. */
  const peeks = (kind: DatasetKind) =>
    provider.peek.mock.calls.filter(([called]) => called === kind);

  beforeEach(() => {
    // localStorage is not exposed in this test environment - ServerConfigService tolerates
    // that by design, so just clear it when it happens to exist.
    globalThis.localStorage?.clear();
    vi.useFakeTimers();

    provider = {
      label: signal('http://test-server:5000'),
      sourceStatus: vi.fn().mockResolvedValue('exists'),
      peek: vi.fn().mockResolvedValue({ state: 'ready' }),
      request: vi.fn(),
      putSource: vi.fn().mockResolvedValue(undefined),
      status: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [{ provide: DatasetProvider, useValue: provider }],
    });

    service = TestBed.inject(DatasetActionsService);
    config = TestBed.inject(ServerConfigService);
    TestBed.tick(); // let the server-url effect run once, against an empty tracked set
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks a hash when it first appears, and not again on re-track', () => {
    service.trackHashes(['a', 'b']);
    expect(peeks('transcript')).toHaveLength(2);

    service.trackHashes(['a', 'b']);
    expect(peeks('transcript')).toHaveLength(2);
  });

  it('forgets a hash once it leaves the table', async () => {
    service.trackHashes(['a', 'b']);
    await settle();
    expect(service.transcriptStatusByHash().has('b')).toBe(true);

    service.trackHashes(['a']);
    expect(service.transcriptStatusByHash().has('b')).toBe(false);
    expect(service.transcriptStatusByHash().has('a')).toBe(true);
  });

  it('re-checks every tracked hash when the nominated server changes', async () => {
    service.trackHashes(['a']);
    await settle();
    provider.peek.mockClear();
    provider.sourceStatus.mockClear();

    config.setServerUrl('http://somewhere-else:5000');
    TestBed.tick();

    expect(provider.peek).toHaveBeenCalledWith('transcript', 'a');
    expect(provider.sourceStatus).toHaveBeenCalledWith('a');
  });

  it('drops stale answers immediately when the server changes', async () => {
    service.trackHashes(['a']);
    await settle();
    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'ready' });

    // Never resolves, so the map stays as the switch left it.
    provider.peek.mockReturnValue(new Promise(() => {}));
    config.setServerUrl('http://somewhere-else:5000');
    TestBed.tick();

    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'checking' });
  });

  it('polls a running job to completion without flickering to "checking"', async () => {
    provider.peek.mockResolvedValue({ state: 'running' });
    service.trackHashes(['a']);
    await settle();
    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'running' });

    provider.peek.mockResolvedValue({ state: 'ready' });
    vi.advanceTimersByTime(REFRESH_MS);

    // The whole point of the quiet refresh: the badge holds its last real answer while the
    // request is in flight, rather than bouncing back to a spinner every five seconds.
    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'running' });

    await settle();
    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'ready' });
  });

  it('reports a provider that could not be asked as an error, distinct from absent', async () => {
    provider.peek.mockRejectedValue(new Error('connection refused'));
    service.trackHashes(['a']);
    await settle();

    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'error' });
  });

  it('stops polling once nothing is in a non-terminal state', async () => {
    service.trackHashes(['a']);
    await settle();
    provider.peek.mockClear();
    provider.sourceStatus.mockClear();

    vi.advanceTimersByTime(REFRESH_MS * 3);

    expect(provider.peek).not.toHaveBeenCalled();
    expect(provider.sourceStatus).not.toHaveBeenCalled();
  });

  it('keeps retrying a hash it could not reach the server for, and recovers', async () => {
    provider.sourceStatus.mockResolvedValue('error');
    service.trackHashes(['a']);
    await settle();
    expect(service.serverStatusByHash().get('a')).toBe('error');

    provider.sourceStatus.mockResolvedValue('exists');
    vi.advanceTimersByTime(REFRESH_MS);
    await settle();

    expect(service.serverStatusByHash().get('a')).toBe('exists');
  });

  it('leaves a hash alone while one of its actions is already in flight', async () => {
    provider.peek.mockResolvedValue({ state: 'running' });
    service.trackHashes(['a']);
    await settle();

    // fetchTranscript marks the hash as sending; it polls and writes its own result.
    service.sendingTranscript.set(new Set(['a']));
    provider.peek.mockClear();

    vi.advanceTimersByTime(REFRESH_MS);
    expect(peeks('transcript')).toHaveLength(0);
  });
});

describe('DatasetActionsService records the settings a result was made with', () => {
  let request: ReturnType<typeof vi.fn>;
  let service: DatasetActionsService;

  beforeEach(() => {
    globalThis.localStorage?.clear();
    request = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatasetProvider,
          useValue: {
            label: signal('http://test-server:5000'),
            sourceStatus: vi.fn().mockResolvedValue('exists'),
            peek: vi.fn().mockResolvedValue({ state: 'absent' }),
            request,
            putSource: vi.fn(),
            status: vi.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(DatasetActionsService);
  });

  const record = (): VideoRecord => ({
    sort_name: 'Lecture 1',
    video_file: { file: null, hash: 'abc', exists_on_server: true, duration_secs: 120 },
    ds_youtubeContent: null,
    ds_youtubeAudienceRetention: null,
    ds_transcript: { state: 'absent' },
    ds_transcriptStats: { state: 'absent' },
    ds_sceneStats: { state: 'absent' },
    ds_textStats: { state: 'absent' },
    ds_audioStats: { state: 'absent' },
  });

  it('keeps the scene threshold the server reported', async () => {
    request.mockResolvedValue({
      state: 'ready',
      producer: 'opencv+pyav/threshold=30.0',
      settings: { threshold: 30 },
      duration_secs: 120,
      scenes: 4,
    });
    const target = record();

    await service.fetchSceneStats(target);

    expect(target.ds_sceneStats).toMatchObject({ state: 'ready', settings: { threshold: 30 } });
  });

  it("adds this browser's pace window to the transcript stats' settings", async () => {
    request.mockResolvedValue({
      state: 'ready',
      producer: 'faster-whisper/tiny.en/en',
      settings: { model: 'tiny.en', language: 'en', vad: false },
      segments: [{ start: 0, end: 60, text: 'hello there' }],
      count_chars: 11,
      count_words: 2,
    });
    const target = record();

    await service.fetchTranscript(target);

    expect(target.ds_transcript).toMatchObject({
      settings: { model: 'tiny.en', language: 'en', vad: false },
    });
    expect(target.ds_transcriptStats).toMatchObject({
      settings: { model: 'tiny.en', language: 'en', vad: false, pace_window_secs: 30 },
    });
  });
});
