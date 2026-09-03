import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SceneStats, Transcript, TranscriptSegment, TranscriptStats } from './video-records/Dataset';
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

// The 'complete' shape of a GET .../transcript response. `segments` comes back empty for a
// row transcribed before segment timing was stored - those have counts but no recoverable
// transcript, and need regenerating.
type TranscriptApiResponse = TranscriptStats & { segments: TranscriptSegment[] };

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

  // The server returns segment timing and stats in one payload; the client models them as
  // two separate cacheable fields, so split here.
  //
  // `regenerate` throws away whatever the server already has for this video and re-runs
  // Whisper. Only pass it for an explicit user request: it's the one way to get segment
  // timing for a video transcribed before segments were stored, but it also costs a full
  // (minutes-long) transcription run.
  async getTranscript(
    fileHash: string,
    options?: { regenerate?: boolean },
  ): Promise<{ transcript: Transcript; stats: TranscriptStats }> {
    const { count_chars, count_words, segments } = await this.pollDataset<TranscriptApiResponse>(
      `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/transcript`,
      options,
    );
    return { transcript: { segments: segments ?? [] }, stats: { count_chars, count_words } };
  }

  getSceneStats(fileHash: string): Promise<SceneStats> {
    return this.pollDataset<SceneStats>(
      `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/scene_stats`,
    );
  }

  /** Reports current transcript status without ever starting generation -
   * safe to call for every row in a table without side effects. */
  peekTranscriptStatus(fileHash: string): Promise<DatasetStatusResponse<TranscriptApiResponse>> {
    return firstValueFrom(
      this.http.get<DatasetStatusResponse<TranscriptApiResponse>>(
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

  private async pollDataset<T>(url: string, options?: { regenerate?: boolean }): Promise<T> {
    const deadline = Date.now() + DATASET_POLL_TIMEOUT_MS;

    // Every call to pollDataset() is a fresh, top-level, user-initiated action
    // (never a passive continuation), so the *first* request may reclaim a
    // previously-failed job - inert unless the row happens to be 'failed'.
    // Only this first request retries; the poll loop below never does, so a
    // failure discovered mid-poll still surfaces as 'failed' and throws below,
    // rather than silently retrying forever. `regenerate` reclaims a *completed*
    // row too, so it likewise only ever rides on this first request - the poll
    // loop must not keep restarting the job it's waiting on.
    const claim = options?.regenerate ? 'regenerate=true' : 'retry=true';
    let result = await firstValueFrom(this.http.get<DatasetStatusResponse<T>>(`${url}?${claim}`));
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
