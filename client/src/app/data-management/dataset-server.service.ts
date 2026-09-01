import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SceneStats, Transcript } from './video-records/Dataset';
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
// dataset reaches a terminal ('complete' or 'failed') state.
type DatasetStatusResponse<T> =
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

  getTranscript(fileHash: string): Promise<Transcript> {
    return this.pollDataset<Transcript>(
      `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/transcript`,
    );
  }

  getSceneStats(fileHash: string): Promise<SceneStats> {
    return this.pollDataset<SceneStats>(
      `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/scene_stats`,
    );
  }

  private async pollDataset<T>(url: string): Promise<T> {
    const deadline = Date.now() + DATASET_POLL_TIMEOUT_MS;

    let result = await firstValueFrom(this.http.get<DatasetStatusResponse<T>>(url));
    while (result.status === 'processing') {
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
