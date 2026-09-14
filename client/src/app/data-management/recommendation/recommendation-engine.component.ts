import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { SelectionService } from '../video-records/selection.service';
import { buildVideoFeatures } from '../analysis/analysis.service';
import { AnalysisFeatureColumn, FEATURE_LABELS } from '../analysis/stats';
import {
  RecommendationListComponent,
  RecommendationRow,
} from '../analysis/recommendation-list.component';
import { RecommendationService, Suggestion, VideoRecommendation } from './recommendation.service';

/** One feature the model thinks is holding this video back, ready to render. */
type Improvement = {
  key: string;
  label: string;
  suggestion: Suggestion;
  advice: string;
  value: number;
  trainingMean: number;
  contribution: number;
};

/**
 * The Recommend step: hands one video to the model the server holds, and shows
 * its predicted performance and where it could improve.
 *
 * One record, not a selection, unlike Scan and Export: the model speaks about a
 * single video, so acting on three of them would have to mean three answers or
 * a silently ignored two.
 */
@Component({
  selector: 'recommendation-engine',
  standalone: true,
  imports: [MatButtonModule, MatIcon, RecommendationListComponent],
  template: `
    <section class="card actions-column">
      <div class="actions">
        <button
          mat-raised-button
          color="primary"
          [disabled]="!submittable() || pending()"
          (click)="submit()"
        >
          <mat-icon>online_prediction</mat-icon>
          Submit for Recommendations
        </button>
      </div>

      <!-- After the button, as on the Export step: this is read having already
           found the button greyed out, so it explains rather than instructs. -->
      <p class="action-hint">{{ selectionHint() }}</p>

      @if (status()) {
        <p class="action-status">{{ status() }}</p>
      }
    </section>

    @if (result(); as result) {
      <section class="card">
        <h2>Predicted performance</h2>
        <p class="prediction">
          <span class="prediction-value">{{ percent(result.average_percentage_viewed) }}</span>
          average percentage viewed
        </p>
        <p class="model-note">
          From the model held on the dataset server, not from your own records - the Analysis step
          is the one that reports on those. The model is currently trained on generated sample data,
          so read this as a demonstration of the method rather than advice.
        </p>
      </section>

      <section class="card">
        <h2>Where this video could improve</h2>
        @if (improvements().length === 0) {
          <p class="model-note">
            Nothing stands out: wherever the model sees a meaningful relationship, this video
            already sits on the side of the training average associated with higher viewing.
          </p>
        } @else {
          <p class="model-note">
            Largest estimated cost first. These are associations in the training data, not a promise
            that changing one will raise viewing.
          </p>
          <ul class="improvement-list">
            @for (item of improvements(); track item.key) {
              <li class="improvement">
                <span class="direction">{{ item.suggestion }}</span>
                <div>
                  <strong>{{ item.label }}</strong>
                  - {{ number(item.value) }} in this video, against a training average of
                  {{ number(item.trainingMean) }}
                  <span class="cost">({{ number(item.contribution) }} points)</span>
                  <div class="advice">{{ item.advice }}</div>
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <section class="card">
        <h2>What the model learned across its training data</h2>
        <recommendation-list [rows]="rows()" />
      </section>
    }
  `,
  styles: [
    `
      .model-note {
        margin: 0 0 12px;
        color: var(--mat-sys-on-surface-variant);
      }
      h2 {
        margin-top: 0;
      }
      .prediction {
        margin: 0 0 8px;
      }
      .prediction-value {
        font-size: 2.2em;
        font-weight: 600;
        margin-right: 6px;
      }
      .improvement-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .improvement {
        display: flex;
        align-items: baseline;
        gap: 10px;
      }
      .direction {
        flex: none;
        min-width: 72px;
        text-align: center;
        text-transform: uppercase;
        font-size: 0.7em;
        letter-spacing: 0.06em;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid currentColor;
        color: var(--mat-sys-primary);
      }
      .cost,
      .advice {
        color: var(--mat-sys-on-surface-variant);
      }
      .advice {
        margin-top: 2px;
      }
    `,
  ],
})
export class RecommendationEngineComponent {
  private selectionService = inject(SelectionService);
  private recommendationService = inject(RecommendationService);

  protected pending = signal(false);
  protected status = signal<string | null>(null);
  protected result = signal<VideoRecommendation | null>(null);

  /** The one selected record, or null when the selection is not exactly one. */
  private chosen = computed(() => {
    if (this.selectionService.selectedCount() !== 1) return null;
    return this.selectionService.selection.selected[0] ?? null;
  });

  /** Recomputed from the record rather than cached, so a Scan finishing while
   * the record is selected makes it submittable without reselecting it. */
  private features = computed(() => {
    const record = this.chosen();
    return record ? buildVideoFeatures(record) : null;
  });

  protected submittable = computed(() => !!this.chosen()?.video_file.hash && !!this.features());

  /** Says which way the selection is wrong, rather than only that it is. */
  protected selectionHint = computed(() => {
    const count = this.selectionService.selectedCount();
    if (count === 0) return 'Select one record in the table below to submit it.';
    if (count > 1)
      return `Select just one record - ${count} are selected, and the model reports on a single video.`;
    if (!this.chosen()?.video_file.hash)
      return 'The selected record has no video file attached, so there is nothing to submit.';
    if (!this.features())
      return 'The selected record has not been fully scanned - run Scan first, since the model needs its scene and transcript stats.';
    return "Sends the selected video's scanned features to the server's model.";
  });

  protected improvements = computed<Improvement[]>(() => {
    const result = this.result();
    if (!result) return [];
    return Object.entries(result.features)
      .filter(([, f]) => f.suggestion === 'increase' || f.suggestion === 'decrease')
      .sort(([, a], [, b]) => a.contribution - b.contribution)
      .map(([key, f]) => ({
        key,
        label: labelFor(key),
        suggestion: f.suggestion,
        advice: f.advice,
        value: f.value,
        trainingMean: f.training_mean,
        contribution: f.contribution,
      }));
  });

  protected rows = computed<RecommendationRow[]>(() => {
    const result = this.result();
    if (!result) return [];
    return Object.entries(result.features).map(([key, f]) => ({
      key,
      label: labelFor(key),
      relationship: f.relationship,
      recommendation: f.recommendation,
    }));
  });

  protected percent = (value: number): string =>
    `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

  protected number = (value: number): string =>
    value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  async submit(): Promise<void> {
    const hash = this.chosen()?.video_file.hash;
    const features = this.features();
    if (!hash || !features) return;

    this.pending.set(true);
    this.status.set(null);
    this.result.set(null);
    try {
      this.result.set(await this.recommendationService.request(hash, features));
    } catch (error) {
      console.error('Recommendation request failed:', error);
      this.status.set(`Could not get recommendations: ${describe(error)}`);
    } finally {
      this.pending.set(false);
    }
  }
}

const labelFor = (key: string): string => FEATURE_LABELS[key as AnalysisFeatureColumn] ?? key;

/** HttpErrorResponse carries the useful part in different places depending on
 * whether the server answered at all. The server's own words come first when
 * there are any - a 400 names the feature it refused. */
const describe = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status, error: body } = error as { status: number; error?: unknown };
    const detail =
      typeof body === 'object' && body !== null && 'err' in body
        ? String((body as { err: unknown }).err)
        : null;
    if (status === 0) return 'the server could not be reached.';
    return detail ? `${detail} (HTTP ${status})` : `HTTP ${status}.`;
  }
  return error instanceof Error ? error.message : String(error);
};
