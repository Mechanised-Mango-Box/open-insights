import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalDatasetProvider } from './local-dataset.provider';
import { RoutingDatasetProvider } from './routing-dataset.provider';
import { ServerDatasetProvider } from './server-dataset.provider';
import { ComputeConfigService } from '../compute-config.service';
import { ComputeQueueService } from '../local-compute/compute-queue.service';
import { ResultCacheService } from '../local-compute/result-cache.service';
import { SourceMissingError, SourceResolver } from './dataset-provider';

const noSource: SourceResolver = { read: async () => null };
const withFile: SourceResolver = { read: async () => new File([new Uint8Array([1])], 'v.mp4') };

describe('LocalDatasetProvider', () => {
  let provider: LocalDatasetProvider;
  let queue: ComputeQueueService;
  let cache: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    cache = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn(async (_k, _h, producer, payload) => ({ state: 'ready', producer, ...payload })),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ResultCacheService, useValue: cache }],
    });
    provider = TestBed.inject(LocalDatasetProvider);
    queue = TestBed.inject(ComputeQueueService);
  });

  it('reports a kind nothing can compute yet as absent rather than guessing', async () => {
    expect(await provider.peek('scene_stats', 'a')).toEqual({ state: 'absent' });
  });

  it('refuses to request a kind nothing can compute yet', async () => {
    await expect(provider.request('transcript', 'a', withFile)).rejects.toThrow(
      /cannot be computed in this browser yet/,
    );
  });

  it('serves a cached result without computing again', async () => {
    const compute = vi.fn();
    queue.register('scene_stats', { producer: 'p', compute });
    cache.get.mockResolvedValue({ state: 'ready', producer: 'p', duration_secs: 9, scenes: 3 });

    const result = await provider.request('scene_stats', 'a', withFile);

    expect(result).toMatchObject({ scenes: 3 });
    expect(compute).not.toHaveBeenCalled();
  });

  it('asks for the bytes only on a cache miss, and says so when there are none', async () => {
    queue.register('scene_stats', { producer: 'p', compute: vi.fn() });

    await expect(provider.request('scene_stats', 'a', noSource)).rejects.toBeInstanceOf(
      SourceMissingError,
    );
  });

  it('computes, caches, and returns the result on a miss', async () => {
    queue.register('scene_stats', {
      producer: 'webcodecs/threshold=30',
      compute: async () => ({ duration_secs: 12, scenes: 5 }),
    });

    const result = await provider.request('scene_stats', 'a', withFile);

    expect(result).toMatchObject({
      state: 'ready',
      producer: 'webcodecs/threshold=30',
      scenes: 5,
    });
    expect(cache.put).toHaveBeenCalledWith('scene_stats', 'a', 'webcodecs/threshold=30', {
      duration_secs: 12,
      scenes: 5,
    });
  });
});

describe('RoutingDatasetProvider', () => {
  let routing: RoutingDatasetProvider;
  let config: ComputeConfigService;
  let local: { peek: ReturnType<typeof vi.fn>; label: ReturnType<typeof signal<string>> };
  let server: { peek: ReturnType<typeof vi.fn>; label: ReturnType<typeof signal<string>> };

  beforeEach(() => {
    globalThis.localStorage?.clear();
    local = { peek: vi.fn().mockResolvedValue({ state: 'absent' }), label: signal('this browser') };
    server = {
      peek: vi.fn().mockResolvedValue({ state: 'ready' }),
      label: signal('http://s:5000'),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: LocalDatasetProvider, useValue: local },
        { provide: ServerDatasetProvider, useValue: server },
      ],
    });
    routing = TestBed.inject(RoutingDatasetProvider);
    config = TestBed.inject(ComputeConfigService);
  });

  it('sends everything to the server by default', async () => {
    await routing.peek('scene_stats', 'a');
    await routing.peek('transcript', 'a');

    expect(server.peek).toHaveBeenCalledTimes(2);
    expect(local.peek).not.toHaveBeenCalled();
  });

  it('routes one kind locally while the other stays on the server', async () => {
    config.setTarget('scene_stats', 'local');

    await routing.peek('scene_stats', 'a');
    await routing.peek('transcript', 'a');

    expect(local.peek).toHaveBeenCalledWith('scene_stats', 'a');
    expect(server.peek).toHaveBeenCalledWith('transcript', 'a');
  });

  it('names both places while the kinds are split, and one when they agree', () => {
    expect(routing.label()).toBe('http://s:5000');

    // Ordered by DATASET_KINDS, so transcript's server leads while only scene
    // stats has moved.
    config.setTarget('scene_stats', 'local');
    expect(routing.label()).toBe('http://s:5000 + this browser');

    config.setTarget('transcript', 'local');
    expect(routing.label()).toBe('this browser');
  });
});
