import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { SelectionService } from '../video-records/selection.service';
import { FEATURE_LABELS } from '../analysis/stats';
import {
  RecommendationListComponent,
  RecommendationRow,
} from '../analysis/recommendation-list.component';
import { Recommendations } from '../analysis/recommendations';
import { RecommendationService } from './recommendation.service';

/**
 * The Recommend step: hands one video to the model the server holds and shows
 * what it says about it.
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

    @if (rows().length > 0) {
      <section class="card">
        <h2>What the model says about this video</h2>
        <p class="model-note">
          From the model held on the dataset server, not from your own records - the Analysis step
          is the one that reports on those.
        </p>
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
    `,
  ],
})
export class RecommendationEngineComponent {
  private selectionService = inject(SelectionService);
  private recommendationService = inject(RecommendationService);

  protected pending = signal(false);
  protected status = signal<string | null>(null);
  private result = signal<Recommendations | null>(null);

  /** The one selected record, or null when the selection is not exactly one. */
  private chosen = computed(() => {
    if (this.selectionService.selectedCount() !== 1) return null;
    return this.selectionService.selection.selected[0] ?? null;
  });

  protected submittable = computed(() => !!this.chosen()?.video_file.hash);

  /** Says which way the selection is wrong, rather than only that it is. A
   * record with no hash is the third case, and the least guessable of them. */
  protected selectionHint = computed(() => {
    const count = this.selectionService.selectedCount();
    if (count === 0) return 'Select one record in the table below to submit it.';
    if (count > 1)
      return `Select just one record - ${count} are selected, and the model reports on a single video.`;
    return this.chosen()?.video_file.hash
      ? 'Submits the selected record to the server for analysis.'
      : 'The selected record has no video file attached, so there is nothing to submit.';
  });

  protected rows = computed<RecommendationRow[]>(() => {
    const result = this.result();
    if (!result) return [];
    return Object.entries(result.features).map(([key, value]) => ({
      key,
      label: FEATURE_LABELS[key as keyof typeof FEATURE_LABELS] ?? key,
      ...value,
    }));
  });

  async submit(): Promise<void> {
    const hash = this.chosen()?.video_file.hash;
    if (!hash) return;

    this.pending.set(true);
    this.status.set(null);
    this.result.set(null);
    try {
      this.result.set(await this.recommendationService.request(hash));
    } catch (error) {
      // The route is a stub, so this is the expected path for now. Reporting
      // the server's own words beats a generic failure, since "not implemented"
      // is the single most useful thing it can currently say.
      console.error('Recommendation request failed:', error);
      this.status.set(`Could not get recommendations: ${describe(error)}`);
    } finally {
      this.pending.set(false);
    }
  }
}

/** HttpErrorResponse carries the useful part in different places depending on
 * whether the server answered at all. */
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
