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
 * has it and can run it, the server's default otherwise, and failing that the
 * first model it can run - a server whose default is missing or broken still
 * has the others to offer, and choosing nothing left the page with no way on.
 * A plain function so the fallback can be tested without an injector.
 */
export const resolveSelection = (
  list: ModelList | null,
  storedId: string | null,
): ModelEntry | null => {
  if (!list) return null;
  const usable = list.models.filter((m) => m.compatible);
  return (
    usable.find((m) => m.id === storedId) ??
    usable.find((m) => m.id === list.default) ??
    usable[0] ??
    null
  );
};

/**
 * Why a loaded list offers nothing to choose, or null when it does. Names each
 * model's first problem, and a default the server says it has but does not list -
 * the usual sign of a server running other code than the files beside it.
 */
export const unusableReason = (list: ModelList | null): string | null => {
  if (!list || list.models.some((m) => m.compatible)) return null;
  if (list.models.length === 0) return 'This server lists no engagement models.';
  const reasons = list.models.map((m) => `${m.card?.name ?? m.id}: ${m.problems[0] ?? 'unusable'}`);
  const missingDefault = list.models.some((m) => m.id === list.default)
    ? ''
    : ` Its default model, '${list.default}', is not among them.`;
  return (
    `None of this server's models can be used (${reasons.join('; ')}).${missingDefault} ` +
    'Restart or update the server, or add a model on its own page.'
  );
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
  /** Set when the server answered but offers no model that can be used. */
  readonly unusable = computed(() => unusableReason(this.models()));
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
