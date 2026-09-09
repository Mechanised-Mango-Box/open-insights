import { Injectable, inject } from '@angular/core';
import { VideoDatabaseService } from '../video-records/video-database.service';
import { DatasetKind, DatasetPayload, DatasetReady } from '../providers/dataset-provider';

/**
 * Durable store for datasets computed in this browser, keyed by kind and
 * content hash.
 *
 * This is the whole of the local persistence story. There is deliberately no
 * companion job table: an interrupted run is resumed by scanning again, and a
 * cached result is what makes the second run skip everything already done. The
 * server needed a job table because a worker could die in another process
 * unobserved; one tab owns its workers and is told directly.
 */
@Injectable({ providedIn: 'root' })
export class ResultCacheService {
  private videoDb = inject(VideoDatabaseService);

  /**
   * The stored dataset, but only if `producer` made it.
   *
   * A row stamped with anything else was produced by a different model or a
   * different parameter, so it reads as absent and gets recomputed - the rule
   * server/db.py's dataset_state() applies, and the reason results from two
   * implementations can never be silently averaged into one corpus.
   */
  async get<K extends DatasetKind>(
    kind: K,
    hash: string,
    producer: string,
  ): Promise<DatasetReady<DatasetPayload[K]> | null> {
    const db = await this.videoDb.database();
    const row = await db.get('dataset_results', [kind, hash]);
    if (!row || row.producer !== producer) return null;
    return {
      state: 'ready',
      producer: row.producer,
      produced_at: row.produced_at,
      ...(row.payload as DatasetPayload[K]),
    };
  }

  async put<K extends DatasetKind>(
    kind: K,
    hash: string,
    producer: string,
    payload: DatasetPayload[K],
  ): Promise<DatasetReady<DatasetPayload[K]>> {
    const produced_at = new Date().toISOString();
    const db = await this.videoDb.database();
    await db.put('dataset_results', { kind, file_hash: hash, producer, produced_at, payload });
    return { state: 'ready', producer, produced_at, ...payload };
  }

  /** Drops a single cached dataset. Used when a result is explicitly discarded;
   * a superseded producer needs no deletion, since it already reads as absent. */
  async forget(kind: DatasetKind, hash: string): Promise<void> {
    const db = await this.videoDb.database();
    await db.delete('dataset_results', [kind, hash]);
  }
}
