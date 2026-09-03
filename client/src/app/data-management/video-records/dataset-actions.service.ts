import { Injectable, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatasetServerService } from '../dataset-server.service';
import { VideoRecord } from './VideoRecord';
import { computeTranscriptStats } from './Dataset';
import { DatasetPeekResult, ServerStatus } from './dataset-status';

/**
 * The one implementation of "do a server dataset action to a video record", shared by every
 * entry point that offers one: the table's per-row buttons, the Scan tab's bulk buttons (which
 * are just these actions applied across the selection) and the edit dialog. Also owns the
 * per-hash status/in-flight state behind the badges, so an action started from one place shows
 * up everywhere the same record is on screen.
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

  // In-flight actions, keyed by file hash.
  uploadingFile = signal<Set<string>>(new Set());
  sendingTranscript = signal<Set<string>>(new Set());
  sendingSceneStats = signal<Set<string>>(new Set());

  // Last-known server state, keyed by file hash.
  serverStatusByHash = signal<Map<string, ServerStatus>>(new Map());
  transcriptStatusByHash = signal<Map<string, DatasetPeekResult>>(new Map());
  sceneStatsStatusByHash = signal<Map<string, DatasetPeekResult>>(new Map());

  async checkServerStatus(hash: string): Promise<void> {
    this.serverStatusByHash.update((map) => new Map(map).set(hash, 'checking'));
    let status: ServerStatus;
    try {
      await this.datasetServerService.getVideoMeta(hash);
      status = 'exists';
    } catch (error) {
      status = error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error';
    }
    this.serverStatusByHash.update((map) => new Map(map).set(hash, status));
  }

  async checkTranscriptStatus(hash: string): Promise<void> {
    this.transcriptStatusByHash.update((map) => new Map(map).set(hash, { status: 'checking' }));
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

  async checkSceneStatsStatus(hash: string): Promise<void> {
    this.sceneStatsStatusByHash.update((map) => new Map(map).set(hash, { status: 'checking' }));
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
