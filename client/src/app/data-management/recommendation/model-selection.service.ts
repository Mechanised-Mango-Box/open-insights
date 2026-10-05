import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ServerConfigService } from '../server-config.service';
import {
  ANALYSIS_FEATURE_COLUMNS,
  AnalysisFeatureColumn,
  FeatureSource,
  isFeatureColumn,
  requiredSourcesFor,
} from '../analysis/stats';
import { ModelEntry, ModelList, RecommendationService } from './recommendation.service';

const STORAGE_PREFIX = 'openInsights.engagementModel:';

/**
 * The model a stored choice resolves to: the stored one while the server still
 * has it and can run it, the server's default otherwise. A plain function so the
 * fallback can be tested without an injector.
 */
export const resolveSelection = (
  list: ModelList | null,
  storedId: string | null,
): ModelEntry | null => {
  if (!list) return null;
  const stored = list.models.find((m) => m.id === storedId && m.compatible);
  return stored ?? list.models.find((m) => m.id === list.default) ?? null;
};

/** The features a model asks for, in its order - every feature when there is no
 * model to ask (a server from before model selection). */
export const featuresFor = (entry: ModelEntry | null): AnalysisFeatureColumn[] =>
  entry?.card ? entry.card.features.filter(isFeatureColumn) : [...ANALYSIS_FEATURE_COLUMNS];

const SOURCE_LABELS: Record<FeatureSource, string> = {
  sceneStats: 'scene stats',
  transcriptStats: 'transcript',
  textStats: 'screen text',
  audioStats: 'audio stats',
};

/** "scene stats, transcript, audio stats" - the Scan results a feature set needs. */
export const neededScansLabel = (features: readonly AnalysisFeatureColumn[]): string =>
  requiredSourcesFor(features)
    .map((source) => SOURCE_LABELS[source])
    .join(', ');

/**
 * Which of the dataset server's engagement models the Recommend step asks.
 *
 * The choice is remembered per server, in this browser: model ids belong to the
 * server that holds them, so a choice made against a local server should not
 * follow the browser to the shared one. Models are added on the server's own
 * page, not here - this only lists and chooses.
 */
@Injectable({ providedIn: 'root' })
export class ModelSelectionService {
  private serverConfig = inject(ServerConfigService);
  private recommendationService = inject(RecommendationService);

  readonly models = signal<ModelList | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private storedId = signal<string | null>(null);

  readonly selected = computed(() => resolveSelection(this.models(), this.storedId()));
  readonly features = computed(() => featuresFor(this.selected()));

  constructor() {
    // A new server means a new list and that server's remembered choice.
    effect(() => {
      const serverUrl = this.serverConfig.serverUrl();
      untracked(() => {
        this.storedId.set(this.read(serverUrl));
        void this.refresh();
      });
    });
  }

  async refresh(): Promise<void> {
    const serverUrl = this.serverConfig.serverUrl();
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await this.recommendationService.listModels();
      if (this.serverConfig.serverUrl() === serverUrl) this.models.set(list);
    } catch (error) {
      if (this.serverConfig.serverUrl() !== serverUrl) return;
      this.models.set(null);
      const status = (error as { status?: number })?.status;
      this.error.set(
        status === 404
          ? 'This server predates model selection; it answers with its one built-in model.'
          : status === 0
            ? 'Could not reach the server to list its models.'
            : `Could not list the server's models${status ? ` (HTTP ${status})` : ''}.`,
      );
    } finally {
      this.loading.set(false);
    }
  }

  choose(id: string): void {
    this.storedId.set(id);
    const key = STORAGE_PREFIX + this.serverConfig.serverUrl();
    try {
      localStorage.setItem(key, id);
    } catch {
      // localStorage unavailable (private mode etc.) - the choice holds for this session.
    }
  }

  private read(serverUrl: string): string | null {
    try {
      return localStorage.getItem(STORAGE_PREFIX + serverUrl);
    } catch {
      return null;
    }
  }
}
