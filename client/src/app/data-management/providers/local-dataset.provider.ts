import { Injectable, inject, signal } from '@angular/core';
import { ComputeQueueService } from '../local-compute/compute-queue.service';
import { ResultCacheService } from '../local-compute/result-cache.service';
import {
  DatasetKind,
  DatasetPayload,
  DatasetProvider,
  DatasetReady,
  DatasetStatusResponse,
  ProviderStatus,
  SourceMissingError,
  SourceResolver,
  SourceStatus,
} from './dataset-provider';

/**
 * Computes datasets in this browser.
 *
 * A kind with no registered implementation reports 'absent' and refuses to
 * request, rather than reporting something it cannot produce - which is what
 * lets the routing switch offer local compute per kind as each one lands.
 */
@Injectable({
  providedIn: 'root',
})
export class LocalDatasetProvider extends DatasetProvider {
  private queue = inject(ComputeQueueService);
  private cache = inject(ResultCacheService);

  readonly label = signal('this browser').asReadonly();

  async peek<K extends DatasetKind>(
    kind: K,
    hash: string,
  ): Promise<DatasetStatusResponse<DatasetPayload[K]>> {
    const computer = this.queue.computerFor(kind);
    if (!computer) return { state: 'absent' };

    const cached = await this.cache.get(kind, hash, computer.producer);
    if (cached) return cached;

    // Only after the cache, so a finished result is never reported as still
    // running by an entry that has not been cleaned up yet.
    const inflight = this.queue.stateOf(kind, hash);
    return inflight ? { state: inflight } : { state: 'absent' };
  }

  async request<K extends DatasetKind>(
    kind: K,
    hash: string,
    source: SourceResolver,
  ): Promise<DatasetReady<DatasetPayload[K]>> {
    const computer = this.queue.computerFor(kind);
    if (!computer) {
      throw new Error(`'${kind}' cannot be computed in this browser yet.`);
    }

    // Checked first for the same reason the server provider asks before
    // uploading: the common case in a re-scan is that the answer already exists.
    const cached = await this.cache.get(kind, hash, computer.producer);
    if (cached) return cached;

    const file = await source.read();
    if (!file) {
      throw new SourceMissingError(
        'This record has no video file attached in this session - re-attach it to compute locally.',
      );
    }

    const payload = await this.queue.run(kind, hash, file);
    return this.cache.put(kind, hash, computer.producer, payload);
  }

  /**
   * Always 'exists'. Local compute reads the record's own file, so there is no
   * second copy that could be missing - whether a file is attached at all is a
   * question the record answers, and the table already shows it.
   */
  async sourceStatus(): Promise<SourceStatus> {
    return 'exists';
  }

  /** Nothing to store: the bytes stay where the user put them. */
  async putSource(): Promise<void> {}

  async status(): Promise<ProviderStatus> {
    return this.queue.counts();
  }
}
