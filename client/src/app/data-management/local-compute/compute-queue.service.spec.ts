import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputeQueueService } from './compute-queue.service';
import { SceneStats } from '../video-records/Dataset';

/** A computer whose runs are resolved by hand, so concurrency is observable. */
function controllable() {
  const started: string[] = [];
  const finish = new Map<string, (value: SceneStats) => void>();
  return {
    started,
    finish,
    computer: {
      producer: 'test/scene-stats',
      compute: (file: File) =>
        new Promise<SceneStats>((resolve) => {
          started.push(file.name);
          finish.set(file.name, resolve);
        }),
    },
    release(name: string, value: SceneStats = { duration_secs: 1, scenes: 2 }) {
      finish.get(name)?.(value);
    },
  };
}

const fileNamed = (name: string) => new File([new Uint8Array([1])], name);

/** Lets queued microtask chains settle - the queue awaits a lock, then dispatches. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('ComputeQueueService', () => {
  let queue: ComputeQueueService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    queue = TestBed.inject(ComputeQueueService);
  });

  it('reports a kind as unsupported until something registers for it', () => {
    expect(queue.computerFor('scene_stats')).toBeUndefined();
    queue.register('scene_stats', controllable().computer);
    expect(queue.computerFor('scene_stats')).toBeDefined();
  });

  it('rejects a kind with no registered implementation', async () => {
    await expect(queue.run('transcript', 'a', fileNamed('a'))).rejects.toThrow(
      /No local implementation/,
    );
  });

  it('runs one transcription at a time - WebGPU has a single device', async () => {
    const harness = controllable();
    queue.register('transcript', {
      producer: 'test/transcript',
      compute: harness.computer.compute as never,
    });

    void queue.run('transcript', 'a', fileNamed('a'));
    void queue.run('transcript', 'b', fileNamed('b'));
    await settle();

    expect(harness.started).toEqual(['a']);

    harness.release('a');
    await settle();
    expect(harness.started).toEqual(['a', 'b']);
  });

  it('shares one run between callers asking for the same kind and hash', async () => {
    const harness = controllable();
    queue.register('scene_stats', harness.computer);

    const first = queue.run('scene_stats', 'same', fileNamed('same'));
    const second = queue.run('scene_stats', 'same', fileNamed('same'));
    await settle();

    expect(first).toBe(second);
    expect(harness.started).toEqual(['same']);

    harness.release('same');
    await expect(first).resolves.toEqual({ duration_secs: 1, scenes: 2 });
  });

  it('reports queued, then running, then nothing', async () => {
    const harness = controllable();
    queue.register('transcript', {
      producer: 'test/transcript',
      compute: harness.computer.compute as never,
    });

    const first = queue.run('transcript', 'a', fileNamed('a'));
    const second = queue.run('transcript', 'b', fileNamed('b'));

    // Synchronously after run(), before the lock has been awaited.
    expect(queue.stateOf('transcript', 'a')).toBe('queued');

    await settle();
    expect(queue.stateOf('transcript', 'a')).toBe('running');
    expect(queue.stateOf('transcript', 'b')).toBe('queued');

    harness.release('a');
    await first;
    await settle();
    expect(queue.stateOf('transcript', 'a')).toBeUndefined();

    harness.release('b');
    await second;
  });

  it('surfaces a failure to the caller and frees the slot', async () => {
    let calls = 0;
    queue.register('scene_stats', {
      producer: 'test/scene-stats',
      compute: async () => {
        calls += 1;
        if (calls === 1) throw new Error('undecodable');
        return { duration_secs: 3, scenes: 4 };
      },
    });

    await expect(queue.run('scene_stats', 'bad', fileNamed('bad'))).rejects.toThrow('undecodable');
    // The failure is not remembered - there is no job table for it to sit in, so
    // scanning again retries rather than reporting the old error.
    await expect(queue.run('scene_stats', 'bad', fileNamed('bad'))).resolves.toEqual({
      duration_secs: 3,
      scenes: 4,
    });
  });

  it('reports queue depth and worker load per kind', async () => {
    const harness = controllable();
    queue.register('transcript', {
      producer: 'test/transcript',
      compute: harness.computer.compute as never,
    });

    void queue.run('transcript', 'a', fileNamed('a'));
    void queue.run('transcript', 'b', fileNamed('b'));
    await settle();

    const counts = queue.counts();
    expect(counts.kinds['transcript'].jobs.running).toBe(1);
    expect(counts.kinds['transcript'].jobs.queued).toBe(1);
    expect(counts.kinds['transcript'].workers.total).toBe(1);

    harness.release('a');
    harness.release('b');
  });

  it('fails everything waiting when another tab holds the compute lock', async () => {
    const request = vi.fn(async (_name: string, _opts: unknown, callback: (lock: null) => void) => {
      // ifAvailable hands the callback null when the lock is held elsewhere.
      await callback(null);
    });
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });

    queue.register('scene_stats', controllable().computer);
    await expect(queue.run('scene_stats', 'a', fileNamed('a'))).rejects.toThrow(/another tab/);

    vi.unstubAllGlobals();
  });
});
