import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ServerConfigService } from '../server-config.service';
import { Recommendations } from '../analysis/recommendations';

/**
 * Built as a plain function so it can be tested without standing up HttpClient -
 * no spec in this repo mocks HTTP, and the part worth pinning down is the path,
 * not Angular's request machinery.
 */
export const recommendationUrl = (serverUrl: string, hash: string): string =>
  `${serverUrl}/api/videos/${hash}/recommendation`;

/**
 * Asks the server's trained model what it makes of one video.
 *
 * Distinct from analysis/recommendations.ts despite the name: that fits a
 * regression in the browser across the user's whole dataset, whereas this hands
 * a single video to a model the server already holds.
 *
 * One request and wait, rather than the POST -> 202 -> poll the dataset kinds
 * use. The route is not implemented yet, so a polling state machine would be
 * built against a contract nobody has written; if inference turns out to need
 * queueing, this becomes a poll then.
 */
@Injectable({ providedIn: 'root' })
export class RecommendationService {
  private http = inject(HttpClient);
  private serverConfig = inject(ServerConfigService);

  /** Set deliberately per-request rather than by an interceptor, matching
   * ServerDatasetProvider: the key belongs to the nominated dataset server, and
   * an interceptor would attach it to anything the app later learns to fetch. */
  private authHeaders(): Record<string, string> {
    const key = this.serverConfig.apiKey();
    return key ? { 'X-API-Key': key } : {};
  }

  /**
   * The response is typed as the same Recommendations the Analysis page already
   * renders. That is an assumption, not a contract - the route is a stub, so
   * this is the shape to confirm (or change) when it is implemented.
   */
  async request(hash: string): Promise<Recommendations> {
    return await firstValueFrom(
      this.http.post<Recommendations>(
        recommendationUrl(this.serverConfig.serverUrl(), hash),
        {},
        { headers: this.authHeaders() },
      ),
    );
  }
}
