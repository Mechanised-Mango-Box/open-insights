import { Injectable, computed, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ServerConfigService } from '../server-config.service';
import {
  DatasetKind,
  DatasetPayload,
  DatasetProvider,
  DatasetReady,
  DatasetStatusResponse,
  ProviderStatus,
  SourceMissingError,
  SourceResolver,
  SourceStatus,
} from './dataset-provider';

export type VideoMeta = { file_hash: string; file_ext: string };
export type UploadResult = { file_hash: string; filename: string };

const DATASET_POLL_INTERVAL_MS = 1500;
const DATASET_POLL_TIMEOUT_MS = 10 * 60 * 1000;

/** The server answers "I have no video for this hash" with a 404. This is the
 * only place in the app that knows that, which is the point of the provider
 * seam: everything above it deals in SourceMissingError and 'absent'. */
const isNotFound = (error: unknown): boolean =>
  error instanceof HttpErrorResponse && error.status === 404;

/**
 * Computes datasets by asking the nominated server for them.
 *
 * The server computes transcript/scene_stats asynchronously: POST enqueues or
 * retries, GET reports state and never starts anything. That split is preserved
 * as request()/peek() rather than flattened, because it is what makes the
 * caller's background re-peek safe.
 */
@Injectable({
  providedIn: 'root',
})
export class ServerDatasetProvider extends DatasetProvider {
  private http = inject(HttpClient);
  private serverConfig = inject(ServerConfigService);

  readonly label = computed(() => this.serverConfig.serverUrl());

  private datasetUrl(kind: DatasetKind, hash: string): string {
    // The kind is the server's own path segment, so a third kind needs no
    // mapping table here.
    return `${this.serverConfig.serverUrl()}/api/videos/${hash}/${kind}`;
  }

  async peek<K extends DatasetKind>(
    kind: K,
    hash: string,
  ): Promise<DatasetStatusResponse<DatasetPayload[K]>> {
    try {
      return await firstValueFrom(
        this.http.get<DatasetStatusResponse<DatasetPayload[K]>>(this.datasetUrl(kind, hash)),
      );
    } catch (error) {
      // No video for this hash is not the same thing as no dataset for it, but
      // a badge cannot act on the difference: both mean nothing has been
      // generated here.
      if (isNotFound(error)) return { state: 'absent' };
      throw error;
    }
  }

  async request<K extends DatasetKind>(
    kind: K,
    hash: string,
    source: SourceResolver,
  ): Promise<DatasetReady<DatasetPayload[K]>> {
    const url = this.datasetUrl(kind, hash);
    try {
      // Ask first: this covers both "already uploaded" and "already cached",
      // and is far cheaper than sending the file to find out.
      return await this.pollDataset<DatasetPayload[K]>(url);
    } catch (error) {
      if (!isNotFound(error)) throw error;

      const file = await source.read();
      if (!file) throw new SourceMissingError();

      await this.putSource(file);
      source.stored?.();
      return await this.pollDataset<DatasetPayload[K]>(url);
    }
  }

  async sourceStatus(hash: string): Promise<SourceStatus> {
    try {
      await firstValueFrom(
        this.http.get<VideoMeta>(`${this.serverConfig.serverUrl()}/api/videos/${hash}`),
      );
      return 'exists';
    } catch (error) {
      return isNotFound(error) ? 'missing' : 'error';
    }
  }

  async putSource(file: File): Promise<void> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    await firstValueFrom(
      this.http.post<UploadResult>(`${this.serverConfig.serverUrl()}/api/videos`, formData),
    );
  }

  /** Queue depth and worker load on the *active* (saved) server - not whatever is
   * currently typed into the Settings URL field. Doubles as a reachability check:
   * an unreachable or misconfigured server rejects here rather than reporting. */
  status(): Promise<ProviderStatus> {
    return firstValueFrom(this.http.get<ProviderStatus>(`${this.serverConfig.serverUrl()}/status`));
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

    // Every call to request() is a fresh, top-level, user-initiated action
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
}
