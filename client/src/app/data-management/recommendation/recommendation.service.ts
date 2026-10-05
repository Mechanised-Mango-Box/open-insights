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
export const recommendationUrl = (serverUrl: string, hash: string, modelId?: string): string =>
  `${serverUrl}/api/videos/${hash}/recommendation` +
  (modelId ? `?model=${encodeURIComponent(modelId)}` : '');

export const modelsUrl = (serverUrl: string): string => `${serverUrl}/api/models`;

/** Held-out accuracy of one of a model's two halves. */
export type ModelMetrics = { rmse: number; r2: number };

/**
 * What a model is, as its provider describes it. Mirrors build_card() in
 * server/model_training/model_card.py. Read from plain JSON on the server, so it
 * describes a model without the server having to load it.
 */
export type ModelCard = {
  format_version: number;
  id: string;
  name: string;
  version: string;
  created_at: string;
  description: string;
  provider: { name: string; url: string };
  notes: string;
  model_type: {
    predictor: string;
    predictor_role: string;
    feedback: string;
    feedback_role: string;
  };
  hyperparameters: Record<string, string | number | boolean | null>;
  features: string[];
  feature_definitions: Record<string, string>;
  target: string;
  target_definition: string;
  training: {
    dataset: string | null;
    rows: number;
    train_rows: number;
    test_rows: number;
    test_size: number;
    random_state: number;
    split: string;
  };
  metrics: { random_forest?: ModelMetrics; linear_regression?: ModelMetrics };
  feature_importances: Record<string, number>;
  coefficients: Record<string, number>;
  intercept: number;
  recommendation_threshold: number;
  framework: Record<string, string>;
};

/** One model the server holds. Mirrors ModelRegistry.entries() in server/model_registry.py. */
export type ModelEntry = {
  id: string;
  source: 'builtin' | 'added';
  default: boolean;
  installed_at?: string | null;
  origin?: string | null;
  /** Null only when its model.json could not be read - and then it is not compatible. */
  card: ModelCard | null;
  compatible: boolean;
  problems: string[];
};

export type ModelList = {
  default: string;
  models: ModelEntry[];
  /** Where to find more models to add. Absent from servers before it was added. */
  more_models_url?: string;
};

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
  /** Population SD of the training rows; z_score = (value - training_mean) / training_sd. */
  training_sd?: number;
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
  /** The model that answered. Absent from servers older than model selection. */
  model?: { id: string; name: string | null; version: string | null };
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

  /** Without a model id the server's default answers. */
  async request(
    hash: string,
    features: Partial<VideoFeatures>,
    modelId?: string,
  ): Promise<VideoRecommendation> {
    return await firstValueFrom(
      this.http.post<VideoRecommendation>(
        recommendationUrl(this.serverConfig.serverUrl(), hash, modelId),
        features,
        { headers: this.authHeaders() },
      ),
    );
  }

  async listModels(): Promise<ModelList> {
    return await firstValueFrom(
      this.http.get<ModelList>(modelsUrl(this.serverConfig.serverUrl()), {
        headers: this.authHeaders(),
      }),
    );
  }
}
