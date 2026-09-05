import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatasetServerService } from '../dataset-server.service';
import { ServerConfigService } from '../server-config.service';
import { VideoRecord } from './VideoRecord';
import { DatasetState, LOCAL_RECOMPUTE, computeTranscriptStats, isReady } from './Dataset';
import { DatasetPeekResult, ServerStatus } from './dataset-status';

/** How often a hash still in a non-terminal state gets re-peeked in the background. */
const STATUS_REFRESH_INTERVAL_MS = 5000;

type CheckOptions = {
  /** Skip the leading 'checking' state. Background refreshes set this so a settled icon
   * never flickers back to a spinner underneath the user. */
  quiet?: boolean;
};

/**
 * The one implementation of "do a server dataset action to a video record", shared by every
 * entry point that offers one: the table's per-row buttons, the Scan tab's bulk buttons (which
 * are just these actions applied across the selection) and the edit dialog. Also owns the
 * per-hash status/in-flight state behind the badges, so an action started from one place shows
 * up everywhere the same record is on screen.
 *
 * Those badges are a cache of answers from one particular server, so keeping them honest takes
 * three things, all handled here rather than by each consumer: a first check when a hash comes
 * on screen (trackHashes), wiping the lot when the nominated server changes, and a background
 * re-peek of anything still in a state that can change without the user doing something.
 *
 * Deliberately does *not* touch VideoDatabaseService: persistence stays with the caller,
 * because the edit dialog mustn't write to the DB until the user hits Save.
 *
 * Every action throws on failure so each caller can present the error its own way (a console
 * line for a row click, a counter for a bulk run, an inline message in the dialog); the record
 * itself is left marked up ready to persist either way.
 */
@Injectable({
  providedIn: 'root',
})
export class DatasetActionsService {
  private datasetServerService = inject(DatasetServerService);
  private serverConfig = inject(ServerConfigService);
  private destroyRef = inject(DestroyRef);

  // In-flight actions, keyed by file hash.
  uploadingFile = signal<Set<string>>(new Set());
  sendingTranscript = signal<Set<string>>(new Set());
  sendingSceneStats = signal<Set<string>>(new Set());

  // Last-known server state, keyed by file hash.
  serverStatusByHash = signal<Map<string, ServerStatus>>(new Map());
  transcriptStatusByHash = signal<Map<string, DatasetPeekResult>>(new Map());
  sceneStatsStatusByHash = signal<Map<string, DatasetPeekResult>>(new Map());

  // Hashes currently on screen. Only these are kept fresh - a record that leaves the table
  // stops being polled and drops its cached status.
  private trackedHashes = new Set<string>();

  // Background re-checks in flight. Kept outside the status signals precisely because a
  // background refresh must not publish a 'checking' state.
  private refreshing = new Set<string>();

  constructor() {
    // Every cached status is an answer from one specific server, so pointing the app at a
    // different one invalidates all of them at once. Harmless on the first run, when nothing
    // is tracked yet.
    effect(() => {
      this.serverConfig.serverUrl();
      untracked(() => this.recheckAll());
    });

    const timer = setInterval(() => this.refreshStaleStatuses(), STATUS_REFRESH_INTERVAL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  /**
   * Declares which hashes are currently on screen: newly-arrived ones get their first status
   * check, departed ones are forgotten. Reads no signals, so callers can invoke it from an
   * effect without that effect re-running on every status write.
   */
  trackHashes(hashes: Iterable<string>): void {
    const next = new Set(hashes);

    for (const hash of next) {
      if (!this.trackedHashes.has(hash)) this.checkAll(hash);
    }

    const dropped = [...this.trackedHashes].filter((hash) => !next.has(hash));
    if (dropped.length > 0) this.forget(dropped);

    this.trackedHashes = next;
  }

  async checkServerStatus(hash: string, { quiet }: CheckOptions = {}): Promise<void> {
    if (!quiet) this.serverStatusByHash.update((map) => new Map(map).set(hash, 'checking'));
    let status: ServerStatus;
    try {
      await this.datasetServerService.getVideoMeta(hash);
      status = 'exists';
    } catch (error) {
      status = error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error';
    }
    this.serverStatusByHash.update((map) => new Map(map).set(hash, status));
  }

  async checkTranscriptStatus(hash: string, { quiet }: CheckOptions = {}): Promise<void> {
    if (!quiet) {
      this.transcriptStatusByHash.update((map) => new Map(map).set(hash, { status: 'checking' }));
    }
    let result: DatasetPeekResult;
    try {
      const response = await this.datasetServerService.peekTranscriptStatus(hash);
      result =
        response.state === 'failed'
          ? { status: 'failed', error: response.error }
          : { status: response.state };
    } catch (error) {
      // A 404 means the server has no such video at all, which is a different
      // thing from having no dataset for it - but from a status badge's point
      // of view both mean "nothing has been generated here".
      result =
        error instanceof HttpErrorResponse && error.status === 404
          ? { status: 'absent' }
          : { status: 'error' };
    }
    this.transcriptStatusByHash.update((map) => new Map(map).set(hash, result));
  }

  async checkSceneStatsStatus(hash: string, { quiet }: CheckOptions = {}): Promise<void> {
    if (!quiet) {
      this.sceneStatsStatusByHash.update((map) => new Map(map).set(hash, { status: 'checking' }));
    }
    let result: DatasetPeekResult;
    try {
      const response = await this.datasetServerService.peekSceneStatsStatus(hash);
      result =
        response.state === 'failed'
          ? { status: 'failed', error: response.error }
          : { status: response.state };
    } catch (error) {
      // A 404 means the server has no such video at all, which is a different
      // thing from having no dataset for it - but from a status badge's point
      // of view both mean "nothing has been generated here".
      result =
        error instanceof HttpErrorResponse && error.status === 404
          ? { status: 'absent' }
          : { status: 'error' };
    }
    this.sceneStatsStatusByHash.update((map) => new Map(map).set(hash, result));
  }

  /**
   * Records that a refresh failed, keeping any value already held.
   *
   * The two cases differ in what there is to preserve. Over a 'ready' value the
   * data survives and gains refresh_error: it is still usable, still exports,
   * and still counts toward the analysis - it simply is not the newest. With
   * nothing held, the failure becomes the state in its own right, so that a
   * first-time failure is visible instead of leaving the field looking as
   * though generation had never been attempted.
   */
  private markRefreshFailure<T>(current: DatasetState<T>, error: string): DatasetState<T> {
    if (isReady(current)) {
      return { ...current, refreshing: undefined, refresh_error: error };
    }
    return { state: 'failed', error };
  }

  /**
   * Sends the record's local video file to the server, if there is one to send. Reports
   * 'no-local-file' rather than failing, so the caller decides whether that's worth telling the
   * user about (the table's file-hash button just re-checks status; the dialog says so out loud).
   */
  async uploadFile(record: VideoRecord): Promise<'uploaded' | 'no-local-file'> {
    if (!record.video_file.file) {
      if (record.video_file.hash) await this.checkServerStatus(record.video_file.hash);
      return 'no-local-file';
    }
    const hash = record.video_file.hash;
    if (!hash) throw new Error('No file hash for this record.');

    this.uploadingFile.update((set) => new Set(set).add(hash));
    try {
      await this.datasetServerService.uploadVideo(record.video_file.file);
      record.video_file.exists_on_server = true;
    } finally {
      this.uploadingFile.update((set) => {
        const next = new Set(set);
        next.delete(hash);
        return next;
      });
      await this.checkServerStatus(hash);
    }
    return 'uploaded';
  }

  /**
   * Re-runs server generation for this record's transcript, overwriting local data with the
   * server's result - this is "sync with the server", not pushing local edits verbatim (the
   * dataset-server API has no endpoint to accept those).
   */
  async fetchTranscript(record: VideoRecord): Promise<void> {
    const hash = record.video_file.hash;
    if (!hash) throw new Error('No file hash for this record.');

    this.sendingTranscript.update((set) => new Set(set).add(hash));
    try {
      const { transcript, stats, producer } = await this.fetchOrUpload(record, () =>
        this.datasetServerService.getTranscript(hash),
      );
      record.ds_transcript = { state: 'ready', data: transcript, producer };
      record.ds_transcriptStats = { state: 'ready', data: stats, producer };
    } catch (error) {
      // A failed refresh over a good value keeps the value and records why -
      // losing an eleven-minute transcript to a network blip would be worse
      // than holding one that is merely not the newest. With no prior value
      // there is nothing to keep, so the failure itself becomes the state:
      // previously that case was dropped entirely and read as 'never tried'.
      const message = error instanceof Error ? error.message : String(error);
      record.ds_transcript = this.markRefreshFailure(record.ds_transcript, message);
      record.ds_transcriptStats = this.markRefreshFailure(record.ds_transcriptStats, message);
      throw error;
    } finally {
      this.sendingTranscript.update((set) => {
        const next = new Set(set);
        next.delete(hash);
        return next;
      });
      void this.checkTranscriptStatus(hash);
    }
  }

  async fetchSceneStats(record: VideoRecord): Promise<void> {
    const hash = record.video_file.hash;
    if (!hash) throw new Error('No file hash for this record.');

    this.sendingSceneStats.update((set) => new Set(set).add(hash));
    try {
      const { sceneStats, producer } = await this.fetchOrUpload(record, () =>
        this.datasetServerService.getSceneStats(hash),
      );
      record.ds_sceneStats = { state: 'ready', data: sceneStats, producer };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.ds_sceneStats = this.markRefreshFailure(record.ds_sceneStats, message);
      throw error;
    } finally {
      this.sendingSceneStats.update((set) => {
        const next = new Set(set);
        next.delete(hash);
        return next;
      });
      void this.checkSceneStatsStatus(hash);
    }
  }

  /**
   * Recomputes count_chars/count_words from an already-fetched transcript, locally - no server
   * round-trip. Useful after a transcript's text was edited/imported without its stats being
   * refreshed. Requires a transcript to already be set.
   */
  recomputeTranscriptStats(record: VideoRecord): void {
    if (!isReady(record.ds_transcript)) {
      throw new Error('No transcript to compute stats from - run Extract Transcript first.');
    }
    record.ds_transcriptStats = {
      state: 'ready',
      data: computeTranscriptStats(record.ds_transcript.data),
      producer: LOCAL_RECOMPUTE,
    };
  }

  private checkAll(hash: string, options?: CheckOptions): Promise<unknown> {
    return Promise.all([
      this.checkServerStatus(hash, options),
      this.checkTranscriptStatus(hash, options),
      this.checkSceneStatsStatus(hash, options),
    ]);
  }

  /** Drops every cached answer and asks the current server again. */
  private recheckAll(): void {
    this.serverStatusByHash.set(new Map());
    this.transcriptStatusByHash.set(new Map());
    this.sceneStatsStatusByHash.set(new Map());
    this.refreshing.clear();
    for (const hash of this.trackedHashes) this.checkAll(hash);
  }

  private forget(hashes: string[]): void {
    const without = <T>(map: Map<string, T>): Map<string, T> => {
      const next = new Map(map);
      for (const hash of hashes) next.delete(hash);
      return next;
    };
    this.serverStatusByHash.update(without);
    this.transcriptStatusByHash.update(without);
    this.sceneStatsStatusByHash.update(without);
    for (const hash of hashes) this.refreshing.delete(hash);
  }

  /**
   * Re-peeks the three states that can still change with no input from this browser: a job the
   * server is running (nothing else will tell us it finished - only the caller that started it
   * polls, and it may have been started from another tab or by the Scan tab in a previous
   * session), a hash whose last check couldn't reach the server (which recovers on its own
   * when the server comes back), and 'absent'.
   *
   * 'absent' is the recent addition, and it is here because the server no longer waits to be
   * asked: it now fills in videos with no dataset whenever it has nothing else to do. So a row
   * can go absent -> queued -> ready with this browser doing nothing at all, and without this
   * the badge would sit on "Not started" until a reload.
   *
   * 'complete', 'failed', 'exists' and 'missing' still only move in response to something done
   * here, and every one of those paths already re-checks the hash itself - so polling them
   * would be traffic that can never change an icon.
   */
  private refreshStaleStatuses(): void {
    if (this.trackedHashes.size === 0) return;

    const serverStatuses = this.serverStatusByHash();
    const transcriptStatuses = this.transcriptStatusByHash();
    const sceneStatsStatuses = this.sceneStatsStatusByHash();
    const busy = [this.uploadingFile(), this.sendingTranscript(), this.sendingSceneStats()];

    for (const hash of this.trackedHashes) {
      // An action already in flight writes its own result when it lands.
      if (this.refreshing.has(hash) || busy.some((set) => set.has(hash))) continue;

      // Worth re-asking about: work still in flight will change on its own, an
      // unreachable server may come back, and the server's idle backfill can turn
      // an absent dataset into a ready one unprompted. Both queued and running
      // count - they are two distinct states now, where 'processing' was one.
      const isStale = (result: DatasetPeekResult | undefined): boolean =>
        result?.status === 'absent' ||
        result?.status === 'queued' ||
        result?.status === 'running' ||
        result?.status === 'error';

      const server = serverStatuses.get(hash) === 'error';
      const transcript = isStale(transcriptStatuses.get(hash));
      const sceneStats = isStale(sceneStatsStatuses.get(hash));
      if (!server && !transcript && !sceneStats) continue;

      this.refreshing.add(hash);
      Promise.all([
        server ? this.checkServerStatus(hash, { quiet: true }) : null,
        transcript ? this.checkTranscriptStatus(hash, { quiet: true }) : null,
        sceneStats ? this.checkSceneStatsStatus(hash, { quiet: true }) : null,
      ]).finally(() => this.refreshing.delete(hash));
    }
  }

  // Tries the server first (cheap - covers "already uploaded" and "already cached"). Only
  // sends the file over the network on a 404 (server has no video for this hash yet), and
  // only if we actually have the bytes in memory this session.
  private async fetchOrUpload<T>(record: VideoRecord, fetchFn: () => Promise<T>): Promise<T> {
    try {
      return await fetchFn();
    } catch (error) {
      const notFound = error instanceof HttpErrorResponse && error.status === 404;
      if (notFound && record.video_file.file) {
        await this.datasetServerService.uploadVideo(record.video_file.file);
        record.video_file.exists_on_server = true;
        return await fetchFn();
      }
      throw error;
    }
  }
}
