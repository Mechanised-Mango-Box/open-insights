import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatasetActionsService } from './dataset-actions.service';
import { DatasetServerService } from '../dataset-server.service';
import { ServerConfigService } from '../server-config.service';

const REFRESH_MS = 5000;

/** Lets every pending microtask chain settle - the checks await a response, then write a signal. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('DatasetActionsService status freshness', () => {
  let server: {
    getVideoMeta: ReturnType<typeof vi.fn>;
    peekTranscriptStatus: ReturnType<typeof vi.fn>;
    peekSceneStatsStatus: ReturnType<typeof vi.fn>;
  };
  let service: DatasetActionsService;
  let config: ServerConfigService;

  beforeEach(() => {
    // localStorage is not exposed in this test environment - ServerConfigService tolerates
    // that by design, so just clear it when it happens to exist.
    globalThis.localStorage?.clear();
    vi.useFakeTimers();

    server = {
      getVideoMeta: vi.fn().mockResolvedValue({ file_hash: 'a', file_ext: 'mp4' }),
      peekTranscriptStatus: vi.fn().mockResolvedValue({ status: 'complete' }),
      peekSceneStatsStatus: vi.fn().mockResolvedValue({ status: 'complete' }),
    };

    TestBed.configureTestingModule({
      providers: [{ provide: DatasetServerService, useValue: server }],
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
    expect(server.peekTranscriptStatus).toHaveBeenCalledTimes(2);

    service.trackHashes(['a', 'b']);
    expect(server.peekTranscriptStatus).toHaveBeenCalledTimes(2);
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
    server.peekTranscriptStatus.mockClear();
    server.getVideoMeta.mockClear();

    config.setServerUrl('http://somewhere-else:5000');
    TestBed.tick();

    expect(server.peekTranscriptStatus).toHaveBeenCalledWith('a');
    expect(server.getVideoMeta).toHaveBeenCalledWith('a');
  });

  it('drops stale answers immediately when the server changes', async () => {
    service.trackHashes(['a']);
    await settle();
    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'complete' });

    // Never resolves, so the map stays as the switch left it.
    server.peekTranscriptStatus.mockReturnValue(new Promise(() => {}));
    config.setServerUrl('http://somewhere-else:5000');
    TestBed.tick();

    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'checking' });
  });

  it('polls a processing job to completion without flickering to "checking"', async () => {
    server.peekTranscriptStatus.mockResolvedValue({ status: 'processing' });
    service.trackHashes(['a']);
    await settle();
    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'processing' });

    server.peekTranscriptStatus.mockResolvedValue({ status: 'complete' });
    vi.advanceTimersByTime(REFRESH_MS);

    // The whole point of the quiet refresh: the badge holds its last real answer while the
    // request is in flight, rather than bouncing back to a spinner every five seconds.
    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'processing' });

    await settle();
    expect(service.transcriptStatusByHash().get('a')).toEqual({ status: 'complete' });
  });

  it('stops polling once nothing is in a non-terminal state', async () => {
    service.trackHashes(['a']);
    await settle();
    server.peekTranscriptStatus.mockClear();
    server.peekSceneStatsStatus.mockClear();
    server.getVideoMeta.mockClear();

    vi.advanceTimersByTime(REFRESH_MS * 3);

    expect(server.peekTranscriptStatus).not.toHaveBeenCalled();
    expect(server.peekSceneStatsStatus).not.toHaveBeenCalled();
    expect(server.getVideoMeta).not.toHaveBeenCalled();
  });

  it('keeps retrying a hash it could not reach the server for, and recovers', async () => {
    server.getVideoMeta.mockRejectedValue(new Error('connection refused'));
    service.trackHashes(['a']);
    await settle();
    expect(service.serverStatusByHash().get('a')).toBe('error');

    server.getVideoMeta.mockResolvedValue({ file_hash: 'a', file_ext: 'mp4' });
    vi.advanceTimersByTime(REFRESH_MS);
    await settle();

    expect(service.serverStatusByHash().get('a')).toBe('exists');
  });

  it('leaves a hash alone while one of its actions is already in flight', async () => {
    server.peekTranscriptStatus.mockResolvedValue({ status: 'processing' });
    service.trackHashes(['a']);
    await settle();

    // fetchTranscript marks the hash as sending; it polls and writes its own result.
    service.sendingTranscript.set(new Set(['a']));
    server.peekTranscriptStatus.mockClear();

    vi.advanceTimersByTime(REFRESH_MS);
    expect(server.peekTranscriptStatus).not.toHaveBeenCalled();
  });
});
