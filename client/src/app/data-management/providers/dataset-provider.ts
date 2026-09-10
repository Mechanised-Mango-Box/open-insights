import { Signal } from '@angular/core';
import { SceneStats, TranscriptSegment, TranscriptStats } from '../video-records/Dataset';

/**
 * What computes a dataset for a video. One implementation talks to a server;
 * the next runs the work in this browser.
 *
 * The vocabulary below is the server's own (server/db.py dataset_state), kept
 * unchanged rather than translated: the layers used to have three vocabularies
 * for these states and translating between them is what let them drift. It
 * stays the vocabulary even once no server is involved, because it is the
 * vocabulary the records and the badges are already written in.
 */

export type DatasetKind = 'transcript' | 'scene_stats';

/** Every kind, for the places that have to iterate them (routing settings, queue
 * bookkeeping). Kept beside the type so adding a kind is one edit, not a hunt. */
export const DATASET_KINDS = [
  'transcript',
  'scene_stats',
] as const satisfies readonly DatasetKind[];

/** The 'complete' shape of a transcript dataset - segments and their stats
 * arrive together, though the records model them as two cacheable fields. */
export type TranscriptPayload = TranscriptStats & { segments: TranscriptSegment[] };

/** What each kind resolves to, so `kind` alone determines the payload type and
 * callers do not have to restate it. */
export type DatasetPayload = {
  transcript: TranscriptPayload;
  scene_stats: SceneStats;
};

export type DatasetStatus = 'absent' | 'queued' | 'running' | 'ready' | 'failed';

/** The 'ready' arm on its own: the payload plus what produced it. Named so
 * callers can refer to it without an Extract<> that cannot see through the
 * intersection with T. */
export type DatasetReady<T> = {
  state: 'ready';
  producer: string;
  produced_at?: string;
  refreshing?: 'queued' | 'running';
  refresh_error?: string;
} & T;

export type DatasetStatusResponse<T> =
  | { state: 'absent' }
  | { state: 'queued'; attempts?: number }
  | { state: 'running'; attempts?: number }
  | { state: 'failed'; error: string; attempts?: number }
  | DatasetReady<T>;

/** Whether the provider holds the video's bytes. */
export type SourceStatus = 'exists' | 'missing' | 'error';

export type ProviderJobCounts = { queued: number; running: number; failed: number };

export type ProviderWorkerCounts = {
  total: number;
  busy: number;
  idle: number;
  /** Tasks handed to this pool that have not reached a worker yet - the pool's
   * own backlog, which is not the same number as `jobs.queued`. */
  awaiting_worker: number;
};

/** Queue depth and worker load. Field names are the server's own
 * (server/processing.py queue_status), deliberately unchanged in transit.
 *
 * `kinds` is a Record rather than a fixed pair of keys so a third dataset kind
 * appears here without a client change. */
export type ProviderStatus = {
  status: string;
  queue: ProviderJobCounts;
  workers: { total: number; busy: number; idle: number };
  kinds: Record<string, { jobs: ProviderJobCounts; workers: ProviderWorkerCounts }>;
};

/**
 * Supplies the video's bytes to a provider that does not have them, and is told
 * once they have been stored.
 *
 * Two calls rather than one because the caller owns the record field that says
 * "this provider has the file", and only the caller knows where that field
 * lives - handing the provider the record instead would put persistence
 * concerns inside something whose whole job is computation.
 */
export type SourceResolver = {
  /** The bytes, or null if this browser does not have them this session. */
  read(): Promise<File | null>;
  /** Called after the provider has durably taken them. */
  stored?(): void;
};

/**
 * Raised when an operation needs the video's bytes and the provider has none.
 * The neutral form of the server's 404, so callers can decide whether to supply
 * the file without knowing that HTTP was involved.
 */
export class SourceMissingError extends Error {
  constructor(message = 'The provider has no video for this hash.') {
    super(message);
    this.name = 'SourceMissingError';
  }
}

export abstract class DatasetProvider {
  /** Names where the work happens, for badges: a server URL, or "this browser". */
  abstract readonly label: Signal<string>;

  /**
   * Reports current state and **never starts work**. That split is what makes
   * the background re-peek safe: there is no call shape that accidentally
   * begins a job, so it cannot be got wrong by forgetting a flag.
   *
   * Resolves to 'absent' when the provider has no video for this hash at all -
   * a different thing from having no dataset for it, but the same thing from a
   * status badge's point of view. Rejects only when the provider could not be
   * asked.
   */
  abstract peek<K extends DatasetKind>(
    kind: K,
    hash: string,
  ): Promise<DatasetStatusResponse<DatasetPayload[K]>>;

  /**
   * Starts or retries generation and resolves once it reaches a terminal state,
   * rejecting if it failed. Consults `source` only if it needs the bytes to
   * proceed.
   */
  abstract request<K extends DatasetKind>(
    kind: K,
    hash: string,
    source: SourceResolver,
  ): Promise<DatasetReady<DatasetPayload[K]>>;

  /** Whether this provider holds the bytes for a hash. */
  abstract sourceStatus(hash: string): Promise<SourceStatus>;

  /** Hands over a video's bytes outside of any dataset request. */
  abstract putSource(file: File): Promise<void>;

  /** Queue depth and worker load. Doubles as a reachability check. */
  abstract status(): Promise<ProviderStatus>;
}
