import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  SceneStats,
  Transcript,
  TranscriptSegment,
  TranscriptStats,
} from './video-records/Dataset';
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

export type ServerJobCounts = { queued: number; running: number; failed: number };

export type ServerWorkerCounts = {
  total: number;
  busy: number;
  idle: number;
  /** Tasks handed to this pool that have not reached a thread yet - the executor's
   * own backlog, which is not the same number as `jobs.queued`. */
  awaiting_worker: number;
};

/** The /status payload: queue depth and worker load, as counts. Field names are
 * the server's own (server/processing.py queue_status), deliberately unchanged in
 * transit - the same rule the dataset states below follow.
 *
 * `kinds` is a Record rather than a fixed pair of keys so a third dataset kind
 * registered on the server appears here without a client change. */
export type ServerStatus = {
  status: string;
  queue: ServerJobCounts;
  workers: { total: number; busy: number; idle: number };
  kinds: Record<string, { jobs: ServerJobCounts; workers: ServerWorkerCounts }>;
};

export type AnalysisResult = {
  histograms: Record<string, { bins: number[]; counts: number[] }>;
  correlations: Record<string, number>;
  loess: Record<string, { x: number[]; y: number[] }>;
};

// The server computes transcript/scene_stats asynchronously. GET reports state
// and never starts anything; POST enqueues or retries. That split is why the
// background re-poll below is safe: there is no request shape that accidentally
// starts work, so it cannot be got wrong by forgetting a flag.
//
// These names are the server's own (server/db.py dataset_state), deliberately
// unchanged in transit - the layers used to have three vocabularies for these
// four states and translating between them is what let them drift.
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

// The 'complete' shape of a GET .../transcript response.
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

  /** Queue depth and worker load on the *active* (saved) server - not whatever is
   * currently typed into the Settings URL field. Doubles as a reachability check:
   * an unreachable or misconfigured server rejects here rather than reporting. */
  getServerStatus(): Promise<ServerStatus> {
    return firstValueFrom(this.http.get<ServerStatus>(`${this.serverConfig.serverUrl()}/status`));
  }

  getVideoMeta(fileHash: string): Promise<VideoMeta> {
    return firstValueFrom(
      this.http.get<VideoMeta>(`${this.serverConfig.serverUrl()}/api/videos/${fileHash}`),
    );
  }

  // The server returns segment timing and stats in one payload; the client models them as
  // two separate cacheable fields, so split here.
  async getTranscript(
    fileHash: string,
  ): Promise<{ transcript: Transcript; stats: TranscriptStats; producer: string }> {
    const { count_chars, count_words, segments, producer } =
      await this.pollDataset<TranscriptApiResponse>(
        `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/transcript`,
      );
    return { transcript: { segments }, stats: { count_chars, count_words }, producer };
  }

  async getSceneStats(fileHash: string): Promise<{ sceneStats: SceneStats; producer: string }> {
    const { duration_secs, scenes, producer } = await this.pollDataset<SceneStats>(
      `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/scene_stats`,
    );
    return { sceneStats: { duration_secs, scenes }, producer };
  }

  /** Reports current transcript state. A plain GET starts nothing, so this is
   * safe to call for every row in a table - no ?peek flag to remember. */
  peekTranscriptStatus(fileHash: string): Promise<DatasetStatusResponse<TranscriptApiResponse>> {
    return firstValueFrom(
      this.http.get<DatasetStatusResponse<TranscriptApiResponse>>(
        `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/transcript`,
      ),
    );
  }

  /** Reports current scene_stats state. As above: GET never starts work. */
  peekSceneStatsStatus(fileHash: string): Promise<DatasetStatusResponse<SceneStats>> {
    return firstValueFrom(
      this.http.get<DatasetStatusResponse<SceneStats>>(
        `${this.serverConfig.serverUrl()}/api/videos/${fileHash}/scene_stats`,
      ),
    );
  }

  /** Resolves to the full 'ready' envelope, not just the payload: `producer`
   * travels with the data so a caller can record what made the value it holds. */
  private async pollDataset<T>(url: string): Promise<DatasetReady<T>> {
    // An idle timeout, not a total one: the clock restarts whenever the server reports
    // something new. The server runs a fixed pool of workers, so a job can sit legitimately
    // queued for far longer than any one job takes - a scan of ten videos leaves the last of
    // them behind nine others - and a total deadline failed those on queue depth alone, which
    // is not a fault and not something the caller can do anything about. A job that is truly
    // stuck reports the same state every time and still times out on schedule.
    const signature = (r: DatasetStatusResponse<T>) =>
      `${r.state}/${r.state === 'ready' ? (r.refreshing ?? '') : ''}`;

    let deadline = Date.now() + DATASET_POLL_TIMEOUT_MS;

    // Still in flight - including the case that only exists now: a regeneration
    // over a value that is already good. The server keeps serving the old
    // result (it stays valid until the new one lands) and flags it `refreshing`,
    // so without testing that this would return the stale copy immediately and
    // the fresh result would never be collected.
    const pending = (r: DatasetStatusResponse<T>) =>
      r.state === 'queued' ||
      r.state === 'running' ||
      r.state === 'absent' ||
      (r.state === 'ready' && r.refreshing !== undefined);

    // Every call to pollDataset() is a fresh, top-level, user-initiated action
    // (never a passive continuation), so it opens with the one POST that starts
    // or retries work. Everything after is a GET, which cannot start anything -
    // so a failure discovered mid-poll surfaces as 'failed' and throws below,
    // rather than being quietly retried forever.
    let result = await firstValueFrom(this.http.post<DatasetStatusResponse<T>>(url, null));
    while (pending(result)) {
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for dataset generation to complete.');
      }
      await new Promise((resolve) => setTimeout(resolve, DATASET_POLL_INTERVAL_MS));
      const next = await firstValueFrom(this.http.get<DatasetStatusResponse<T>>(url));
      if (signature(next) !== signature(result)) deadline = Date.now() + DATASET_POLL_TIMEOUT_MS;
      result = next;
    }
    if (result.state === 'failed') {
      throw new Error(result.error);
    }
    // pending() cannot narrow the union for the compiler (it is a function, not
    // a type guard), so restate the invariant here: the loop only exits on a
    // terminal state, and 'failed' is already handled above.
    if (result.state !== 'ready') {
      throw new Error(`Unexpected dataset state '${result.state}'.`);
    }
    return result;
  }

  runAnalysis(rows: AnalysisFeatureRow[]): Promise<AnalysisResult> {
    return firstValueFrom(
      this.http.post<AnalysisResult>(`${this.serverConfig.serverUrl()}/api/analysis`, rows),
    );
  }
}
