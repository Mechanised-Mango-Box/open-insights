import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SceneStats, Transcript, TranscriptBasic, TranscriptStats } from './video-records/Dataset';
import { ServerConfigService } from './server-config.service';

export type VideoMeta = { file_hash: string; file_ext: string };
export type UploadResult = { file_hash: string; filename: string };

export type AnalysisFeatureRow = {
  duration_mins: number;
  wpm: number;
  scene_change_rate: number;
  word_count: number;
  average_percentage_viewed: number;
};

export type AnalysisResult = {
  histograms: Record<string, { bins: number[]; counts: number[] }>;
  correlations: Record<string, number>;
  loess: Record<string, { x: number[]; y: number[] }>;
};

// The server computes transcript/scene_stats asynchronously: a GET returns
// this shape immediately, and the caller polls the same URL until the
// dataset reaches a terminal ('complete' or 'failed') state. 'not_started'
// is only returned when the caller passes `?peek=true` (see peek*Status
// below) - a plain GET always starts generation instead of reporting it.
export type DatasetStatus = 'not_started' | 'processing' | 'complete' | 'failed';

export type DatasetStatusResponse<T> =
  | { status: 'not_started' }
  | { status: 'processing' }
  | { status: 'failed'; error: string }
  | ({ status: 'complete' } & T);

const DATASET_POLL_INTERVAL_MS = 1500;
const DATASET_POLL_TIMEOUT_MS = 10 * 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class DatasetServerService {
  private http = inject(HttpClient);
  private serverConfig = inject(ServerConfigService);

  uploadVideo(file: File): Promise<UploadResult> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return firstValueFrom(
      this.http.post<UploadResult>(`${this.serverConfig.serverUrl()}/api/videos`, formData),
    );
  }

  getVideoMeta(fileHash: string): Promise<VideoMeta> {
    return firstValueFrom(
      this.http.get<VideoMeta>(`${this.serverConfig.serverUrl()}/api/videos/${fileHash}`),
    );
  }

  // The server returns transcript text and stats (count_chars/count_words) in one
  // payload; the client models them as two separate cacheable fields, so split here.
  async getTranscript(fileHash: string): Promise<{ transcript: Transcript; stats: TranscriptStats }> {
    const { text, count_chars, count_words } = await this.pollDataset<TranscriptBasic & TranscriptStats>(
      `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/transcript`,
    );
    return { transcript: { text }, stats: { count_chars, count_words } };
  }

  getSceneStats(fileHash: string): Promise<SceneStats> {
    return this.pollDataset<SceneStats>(
      `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/scene_stats`,
    );
  }

  /** Reports current transcript status without ever starting generation -
   * safe to call for every row in a table without side effects. */
  peekTranscriptStatus(fileHash: string): Promise<DatasetStatusResponse<Transcript>> {
    return firstValueFrom(
      this.http.get<DatasetStatusResponse<Transcript>>(
        `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/transcript?peek=true`,
      ),
    );
  }

  /** Reports current scene_stats status without ever starting generation -
   * safe to call for every row in a table without side effects. */
  peekSceneStatsStatus(fileHash: string): Promise<DatasetStatusResponse<SceneStats>> {
    return firstValueFrom(
      this.http.get<DatasetStatusResponse<SceneStats>>(
        `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/scene_stats?peek=true`,
      ),
    );
  }

  private async pollDataset<T>(url: string): Promise<T> {
    const deadline = Date.now() + DATASET_POLL_TIMEOUT_MS;

    // Every call to pollDataset() is a fresh, top-level, user-initiated action
    // (never a passive continuation), so the *first* request may reclaim a
    // previously-failed job - inert unless the row happens to be 'failed'.
    // Only this first request retries; the poll loop below never does, so a
    // failure discovered mid-poll still surfaces as 'failed' and throws below,
    // rather than silently retrying forever.
    let result = await firstValueFrom(this.http.get<DatasetStatusResponse<T>>(`${url}?retry=true`));
    while (result.status === 'processing' || result.status === 'not_started') {
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for dataset generation to complete.');
      }
      await new Promise((resolve) => setTimeout(resolve, DATASET_POLL_INTERVAL_MS));
      result = await firstValueFrom(this.http.get<DatasetStatusResponse<T>>(url));
    }
    if (result.status === 'failed') {
      throw new Error(result.error);
    }
    return result;
  }

  runAnalysis(rows: AnalysisFeatureRow[]): Promise<AnalysisResult> {
    return firstValueFrom(
      this.http.post<AnalysisResult>(`${this.serverConfig.serverUrl()}/api/analysis`, rows),
    );
  }
}
