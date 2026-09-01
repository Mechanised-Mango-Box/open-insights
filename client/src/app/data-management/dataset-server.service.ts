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
    return firstValueFrom(
      this.http.get<Transcript>(
        `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/transcript`,
      ),
    );
  }

  getSceneStats(fileHash: string): Promise<SceneStats> {
    return firstValueFrom(
      this.http.get<SceneStats>(
        `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/scene_stats`,
      ),
    );
  }

  runAnalysis(rows: AnalysisFeatureRow[]): Promise<AnalysisResult> {
    return firstValueFrom(
      this.http.post<AnalysisResult>(`${this.serverConfig.serverUrl()}/api/analysis`, rows),
    );
  }
}
