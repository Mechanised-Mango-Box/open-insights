import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ServerConfigService } from '../server-config.service';
import { VideoFeatures } from '../analysis/analysis.service';
import { FeatureRecommendation } from '../analysis/recommendations';

/**
 * Built as a plain function so it can be tested without standing up HttpClient -
 * no spec in this repo mocks HTTP, and the part worth pinning down is the path,
 * not Angular's request machinery.
 */
export const recommendationUrl = (serverUrl: string, hash: string): string =>
  `${serverUrl}/api/videos/${hash}/recommendation`;

/** Which way a feature would have to move to sit where the training data sees
 * higher viewing. "keep" means it already does; "none" means the relationship
 * is too weak for the model to say. */
export type Suggestion = 'increase' | 'decrease' | 'keep' | 'none';

/**
 * One feature of one video, as the server's model sees it. Mirrors the
 * per-feature dict EngagementPredictor.predict() builds in server/inference.py.
 *
 * The FeatureRecommendation half is the dataset-level relationship, identical
 * for every video; the rest is what makes it about this one.
 */
export type VideoFeatureAssessment = FeatureRecommendation & {
  value: number;
  training_mean: number;
  z_score: number;
  /** Points of average percentage viewed this value moves the linear estimate
   * away from an average training video. Negative is costing views. */
  contribution: number;
  suggestion: Suggestion;
  advice: string;
};

export type VideoRecommendation = {
  /** The random forest's prediction, in percent. Not clipped to 0-100. */
  average_percentage_viewed: number;
  threshold: number;
  features: Record<string, VideoFeatureAssessment>;
};

/**
 * Asks the server's trained model what it makes of one video.
 *
 * Distinct from analysis/recommendations.ts despite the name: that fits a
 * regression in the browser across the user's whole dataset, whereas this hands
 * a single video to a model the server already holds.
 *
 * The features travel in the body rather than being read back on the server:
 * two of them are only ever computed in the browser, and a Scan may have run on
 * local compute. One request and wait, rather than the POST -> 202 -> poll the
 * dataset kinds use - inference is a single forest evaluation, not a job.
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

  async request(hash: string, features: VideoFeatures): Promise<VideoRecommendation> {
    return await firstValueFrom(
      this.http.post<VideoRecommendation>(
        recommendationUrl(this.serverConfig.serverUrl(), hash),
        features,
        { headers: this.authHeaders() },
      ),
    );
  }
}
