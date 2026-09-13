import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ResultCacheService } from './result-cache.service';
import { StoredDatasetResult, VideoDatabaseService } from '../video-records/video-database.service';

/** Stands in for the one object store this service touches. Real IndexedDB is
 * not available in this environment, and the rule under test - what a producer
 * mismatch means - is not a storage behaviour. */
function fakeDatabase() {
  const rows = new Map<string, StoredDatasetResult>();
  const id = (key: [string, string]) => key.join('/');
  return {
    rows,
    handle: {
      get: async (_store: string, key: [string, string]) => rows.get(id(key)),
      put: async (_store: string, value: StoredDatasetResult) => {
        rows.set(id([value.kind, value.file_hash]), value);
      },
      delete: async (_store: string, key: [string, string]) => {
        rows.delete(id(key));
      },
    },
  };
}

describe('ResultCacheService', () => {
  let cache: ResultCacheService;
  let db: ReturnType<typeof fakeDatabase>;

  beforeEach(() => {
    db = fakeDatabase();
    TestBed.configureTestingModule({
      providers: [{ provide: VideoDatabaseService, useValue: { database: async () => db.handle } }],
    });
    cache = TestBed.inject(ResultCacheService);
  });

  it('returns nothing for a hash it has never seen', async () => {
    expect(await cache.get('scene_stats', 'a', 'opencv/threshold=30')).toBeNull();
  });

  it('round-trips a result as a ready envelope, payload spread onto it', async () => {
    await cache.put('scene_stats', 'a', 'webcodecs/threshold=30', {
      duration_secs: 826.191,
      scenes: 62,
    });

    const found = await cache.get('scene_stats', 'a', 'webcodecs/threshold=30');
    expect(found).toMatchObject({
      state: 'ready',
      producer: 'webcodecs/threshold=30',
      duration_secs: 826.191,
      scenes: 62,
    });
    expect(found?.produced_at).toBeTypeOf('string');
  });

  it('reads a result made by a different producer as absent', async () => {
    await cache.put('scene_stats', 'a', 'webcodecs/threshold=30', {
      duration_secs: 826.191,
      scenes: 62,
    });

    // The stored row is untouched - it simply is not an answer to this question.
    expect(await cache.get('scene_stats', 'a', 'webcodecs/threshold=45')).toBeNull();
    expect(db.rows.size).toBe(1);
  });

  it('keeps kinds apart under the same hash', async () => {
    await cache.put('scene_stats', 'a', 'p', { duration_secs: 1, scenes: 2 });
    await cache.put('transcript', 'a', 'p', { count_chars: 3, count_words: 1, segments: [] });

    expect(await cache.get('scene_stats', 'a', 'p')).toMatchObject({ scenes: 2 });
    expect(await cache.get('transcript', 'a', 'p')).toMatchObject({ count_words: 1 });
  });

  it('forgets a result on request', async () => {
    await cache.put('scene_stats', 'a', 'p', { duration_secs: 1, scenes: 2 });
    await cache.forget('scene_stats', 'a');
    expect(await cache.get('scene_stats', 'a', 'p')).toBeNull();
  });
});
