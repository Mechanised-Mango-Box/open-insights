import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatasetServerService } from '../dataset-server.service';
import { ServerConfigService } from '../server-config.service';
import { VideoRecord } from './VideoRecord';
import { computeTranscriptStats } from './Dataset';
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
        response.status === 'failed'
          ? { status: 'failed', error: response.error }
          : { status: response.status };
    } catch (error) {
      result =
        error instanceof HttpErrorResponse && error.status === 404
          ? { status: 'not_started' }
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
        response.status === 'failed'
          ? { status: 'failed', error: response.error }
          : { status: response.status };
    } catch (error) {
      result =
        error instanceof HttpErrorResponse && error.status === 404
          ? { status: 'not_started' }
          : { status: 'error' };
    }
    this.sceneStatsStatusByHash.update((map) => new Map(map).set(hash, result));
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
      const { transcript, stats } = await this.fetchOrUpload(record, () =>
        this.datasetServerService.getTranscript(hash),
      );
      record.ds_transcript = { upload_state: { is_local: false }, data: transcript };
      record.ds_transcriptStats = { upload_state: { is_local: false }, data: stats };
    } catch (error) {
      if (record.ds_transcript) {
        record.ds_transcript = {
          ...record.ds_transcript,
          upload_state: { is_local: true, server_side_state: 'failed' },
        };
      }
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
      const sceneStats = await this.fetchOrUpload(record, () =>
        this.datasetServerService.getSceneStats(hash),
      );
      record.ds_sceneStats = { upload_state: { is_local: false }, data: sceneStats };
    } catch (error) {
      if (record.ds_sceneStats) {
        record.ds_sceneStats = {
          ...record.ds_sceneStats,
          upload_state: { is_local: true, server_side_state: 'failed' },
        };
      }
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
    if (!record.ds_transcript) {
      throw new Error('No transcript to compute stats from - run Extract Transcript first.');
    }
    record.ds_transcriptStats = {
      upload_state: { is_local: true, server_side_state: 'ready' },
      data: computeTranscriptStats(record.ds_transcript.data),
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
   * Re-peeks the two states that can still change with no input from this browser: a job the
   * server is running (nothing else will tell us it finished - only the caller that started it
   * polls, and it may have been started from another tab or by the Scan tab in a previous
   * session), and a hash whose last check couldn't reach the server (which recovers on its own
   * when the server comes back).
   *
   * 'complete', 'failed', 'not_started', 'exists' and 'missing' only move in response to
   * something done here, and every one of those paths already re-checks the hash itself - so
   * polling them would be traffic that can never change an icon.
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

      const isStale = (result: DatasetPeekResult | undefined): boolean =>
        result?.status === 'processing' || result?.status === 'error';

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
