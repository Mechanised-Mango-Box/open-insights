import { Injectable } from '@angular/core';
import {
  DATASET_KINDS,
  DatasetKind,
  DatasetPayload,
  ProviderStatus,
} from '../providers/dataset-provider';

/**
 * One kind's implementation, paired with the stamp that describes it.
 *
 * `producer` and `compute` travel together on purpose: the string has to encode
 * every parameter that could move the numbers, and the only place that knows
 * them all is the implementation itself. Splitting them is how a threshold gets
 * changed without the cache noticing.
 */
export type Computer<K extends DatasetKind> = {
  readonly producer: string;
  compute(file: File): Promise<DatasetPayload[K]>;
};

/**
 * How many videos of each kind may be in flight at once.
 *
 * Read at call time rather than captured, so a lazily-populated
 * hardwareConcurrency is not baked in at construction.
 */
const POOL_SIZES: Record<DatasetKind, () => number> = {
  // The frame loop is one serial pass over a video, so extra workers buy
  // concurrent *videos*, not a faster single scan. One core is left for the UI.
  scene_stats: () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1)),
  // Deliberately not a pool. WebGPU exposes one device, so a second session
  // contends for the same hardware and the same VRAM - it buys no throughput
  // and risks running out of memory on a long video.
  transcript: () => 1,
};

/** Two tabs on the same library share IndexedDB, so both would compute every
 * video and race each other's writes. */
const COMPUTE_LOCK = 'open-insights-compute';

const ANOTHER_TAB =
  'Compute is already running in another tab. Close it, or run the scan from there.';

type QueueEntry = {
  kind: DatasetKind;
  hash: string;
  file: File;
  resolve: (payload: never) => void;
  reject: (error: unknown) => void;
};

type Inflight = { state: 'queued' | 'running'; promise: Promise<unknown> };

/**
 * Runs local compute, a bounded number of videos at a time.
 *
 * In memory only. Nothing here survives a reload, and that is the design: an
 * interrupted batch is recovered by scanning again, which skips everything the
 * result cache already holds. The server's lease/attempt/orphan machinery
 * existed to detect a worker dying in another process - a tab owns its workers
 * and hears about it directly.
 */
@Injectable({ providedIn: 'root' })
export class ComputeQueueService {
  // The value is only ever read back through computerFor(), which restores the
  // kind-payload link that this map cannot express.
  private computers = new Map<DatasetKind, Computer<DatasetKind>>();
  private pending = new Map<DatasetKind, QueueEntry[]>();
  private running = new Map<DatasetKind, number>();
  private inflight = new Map<string, Inflight>();
  private releaseLock: (() => void) | null = null;

  /** Declares how a kind is computed in this browser. Until a kind is
   * registered, the local provider reports it as unavailable rather than
   * pretending it can produce one. */
  register<K extends DatasetKind>(kind: K, computer: Computer<K>): void {
    this.computers.set(kind, computer as Computer<DatasetKind>);
  }

  computerFor<K extends DatasetKind>(kind: K): Computer<K> | undefined {
    return this.computers.get(kind) as Computer<K> | undefined;
  }

  /** Whether this hash is waiting or being worked on right now. */
  stateOf(kind: DatasetKind, hash: string): 'queued' | 'running' | undefined {
    return this.inflight.get(this.key(kind, hash))?.state;
  }

  /**
   * Computes one dataset, waiting for a free slot first.
   *
   * Two callers asking for the same kind and hash share one run rather than
   * doing the work twice - a bulk scan and an on-screen row check reaching the
   * same video at once is ordinary, not exceptional.
   */
  run<K extends DatasetKind>(kind: K, hash: string, file: File): Promise<DatasetPayload[K]> {
    const key = this.key(kind, hash);
    const existing = this.inflight.get(key);
    if (existing) return existing.promise as Promise<DatasetPayload[K]>;

    const promise = new Promise<DatasetPayload[K]>((resolve, reject) => {
      this.queueFor(kind).push({
        kind,
        hash,
        file,
        resolve: resolve as (payload: never) => void,
        reject,
      });
    });

    this.inflight.set(key, { state: 'queued', promise });
    // Settled either way, the entry stops being in flight. Both arms return
    // normally, so this does not become an unhandled rejection of its own.
    const clear = () => this.inflight.delete(key);
    promise.then(clear, clear);

    void this.pump(kind);
    return promise;
  }

  /** Queue depth and worker load, in the shape the Settings tab already renders. */
  counts(): ProviderStatus {
    const kinds: ProviderStatus['kinds'] = {};
    let queued = 0;
    let busy = 0;
    let total = 0;

    for (const kind of DATASET_KINDS) {
      const kindQueued = this.queueFor(kind).length;
      const kindRunning = this.running.get(kind) ?? 0;
      const kindTotal = POOL_SIZES[kind]();
      queued += kindQueued;
      busy += kindRunning;
      total += kindTotal;
      kinds[kind] = {
        // No 'failed' count: nothing here records a failure past the call that
        // raised it, because there is no job table for one to sit in.
        jobs: { queued: kindQueued, running: kindRunning, failed: 0 },
        workers: {
          total: kindTotal,
          busy: kindRunning,
          idle: kindTotal - kindRunning,
          awaiting_worker: kindQueued,
        },
      };
    }

    return {
      status: 'ok',
      queue: { queued, running: busy, failed: 0 },
      workers: { total, busy, idle: total - busy },
      kinds,
    };
  }

  private key(kind: DatasetKind, hash: string): string {
    return `${kind}/${hash}`;
  }

  private queueFor(kind: DatasetKind): QueueEntry[] {
    let queue = this.pending.get(kind);
    if (!queue) {
      queue = [];
      this.pending.set(kind, queue);
    }
    return queue;
  }

  private async pump(kind: DatasetKind): Promise<void> {
    if (this.queueFor(kind).length === 0) return;

    if (!(await this.claimLock())) {
      // Another tab owns compute. Fail everything waiting rather than leaving
      // it queued behind a lock that is not going to be released here.
      const error = new Error(ANOTHER_TAB);
      for (const other of DATASET_KINDS) {
        for (const entry of this.queueFor(other).splice(0)) entry.reject(error);
      }
      return;
    }

    const limit = POOL_SIZES[kind]();
    while ((this.running.get(kind) ?? 0) < limit) {
      const entry = this.queueFor(kind).shift();
      if (!entry) break;
      void this.start(entry);
    }
  }

  private async start(entry: QueueEntry): Promise<void> {
    const { kind, hash } = entry;
    const computer = this.computerFor(kind);

    this.running.set(kind, (this.running.get(kind) ?? 0) + 1);
    const tracked = this.inflight.get(this.key(kind, hash));
    if (tracked) tracked.state = 'running';

    try {
      if (!computer) throw new Error(`No local implementation for '${kind}'.`);
      entry.resolve((await computer.compute(entry.file)) as never);
    } catch (error) {
      entry.reject(error);
    } finally {
      this.running.set(kind, (this.running.get(kind) ?? 1) - 1);
      this.releaseIfIdle();
      void this.pump(kind);
    }
  }

  private idle(): boolean {
    return DATASET_KINDS.every(
      (kind) => (this.running.get(kind) ?? 0) === 0 && this.queueFor(kind).length === 0,
    );
  }

  private releaseIfIdle(): void {
    if (!this.idle()) return;
    this.releaseLock?.();
    this.releaseLock = null;
  }

  /**
   * Takes the cross-tab compute lock, holding it until the queue drains rather
   * than for the life of the tab - an idle tab left open should not stop the
   * user working in a new one.
   *
   * Resolves false when another tab holds it. Absent Web Locks (an older
   * browser, or a test environment) the answer is yes: the guard is worth
   * having where it exists and not worth blocking work where it does not.
   */
  private async claimLock(): Promise<boolean> {
    if (this.releaseLock) return true;
    const locks = navigator.locks;
    if (!locks) return true;

    let granted!: (ok: boolean) => void;
    const acquired = new Promise<boolean>((resolve) => {
      granted = resolve;
    });

    let release!: () => void;
    const untilReleased = new Promise<void>((resolve) => {
      release = resolve;
    });

    void locks.request(COMPUTE_LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        granted(false);
        return;
      }
      granted(true);
      await untilReleased;
    });

    if (!(await acquired)) return false;
    this.releaseLock = release;
    return true;
  }
}
