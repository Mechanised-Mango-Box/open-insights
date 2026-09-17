import { Component, computed, inject, signal } from '@angular/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { DatasetActionsService } from '../video-records/dataset-actions.service';
import { VideoDatabaseService } from '../video-records/video-database.service';
import { VideoRecord } from '../video-records/VideoRecord';
import { buildVideoFeatures } from '../analysis/analysis.service';
import { AnalysisFeatureColumn, FEATURE_LABELS } from '../analysis/stats';
import {
  RecommendationListComponent,
  RecommendationRow,
} from '../analysis/recommendation-list.component';
import { HighlightSegment, highlight, rankFuzzy } from './fuzzy';
import { RecommendationService, Suggestion, VideoRecommendation } from './recommendation.service';
import { SCAN_STEP_LABELS, ScanStep, missingScanSteps } from './scan-first';
import { ScanFirstDialogComponent, ScanFirstDialogData } from './scan-first-dialog.component';

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

/** One entry in the video picker. Every record is choosable; the note only says
 * what submitting it will run into. */
type VideoOption = {
  id: number;
  name: string;
  note: string | null;
};

/**
 * The Recommend step: hands one video to the model the server holds, and shows
 * its predicted performance and where it could improve.
 *
 * Picks its video from its own single-choice search box rather than the shared
 * record table. That table is a multi-select working set for Scan and Export,
 * and borrowing it meant explaining why two ticked rows were wrong; a picker
 * makes "exactly one" the only thing that can be expressed. It fuzzy-matches as
 * you type, because a library of lecture recordings is long and named alike.
 *
 * An unscanned video can still be chosen and submitted. Submitting it opens a
 * dialog offering to run the missing Scan work first, and the request is only
 * sent once that work has produced the features the model needs.
 */
@Component({
  selector: 'recommendation-engine',
  standalone: true,
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIcon,
    MatInputModule,
    RecommendationListComponent,
  ],
  template: `
    <section class="card actions-column">
      <mat-form-field class="video-picker" appearance="outline" subscriptSizing="dynamic">
        <mat-label>Video</mat-label>
        <input
          matInput
          type="text"
          placeholder="Type to search your videos"
          [matAutocomplete]="videoPicker"
          [value]="query()"
          [disabled]="pending()"
          (input)="query.set($any($event.target).value)"
          (focus)="$any($event.target).select()"
        />
        <mat-icon matSuffix>search</mat-icon>
        <mat-autocomplete
          #videoPicker="matAutocomplete"
          autoActiveFirstOption
          [displayWith]="nameOf"
          (optionSelected)="choose($event.option.value)"
          (closed)="restoreQuery()"
        >
          @for (option of matches(); track option.id) {
            <mat-option [value]="option.id">
              @for (segment of option.segments; track $index) {
                @if (segment.match) {
                  <mark>{{ segment.text }}</mark>
                } @else {
                  {{ segment.text }}
                }
              }
              @if (option.note) {
                <span class="option-note">- {{ option.note }}</span>
              }
            </mat-option>
          } @empty {
            <mat-option disabled>
              {{ options().length === 0 ? 'No records yet' : 'No videos match' }}
            </mat-option>
          }
        </mat-autocomplete>
      </mat-form-field>

      <div class="actions">
        <button
          mat-raised-button
          color="primary"
          [disabled]="!chosen() || pending()"
          (click)="submit()"
        >
          <mat-icon>online_prediction</mat-icon>
          Submit for Recommendations
        </button>
      </div>

      <!-- After the button, as on the Export step: this is read having already
           found the button greyed out, so it explains rather than instructs. -->
      <p class="action-hint">{{ hint() }}</p>

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
      .video-picker {
        width: 100%;
        max-width: 480px;
      }
      .option-note {
        margin-left: 4px;
        color: var(--mat-sys-on-surface-variant);
      }
      /* The matched characters, marked by weight and colour rather than the
         browser's yellow <mark> background, which fights the panel's theme. */
      mark {
        background: none;
        color: var(--mat-sys-primary);
        font-weight: 600;
      }
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
  private videoDatabase = inject(VideoDatabaseService);
  private datasetActions = inject(DatasetActionsService);
  private recommendationService = inject(RecommendationService);
  private dialog = inject(MatDialog);

  /** True for the whole submit, scan included, so the picker and button stay
   * locked while a scan is writing to the chosen record. */
  protected pending = signal(false);
  protected status = signal<string | null>(null);
  protected result = signal<VideoRecommendation | null>(null);

  /** Held by id rather than as the record, so the record is always read fresh
   * from the database signal: a Scan finishing updates it in place, and a
   * deleted record drops the choice instead of lingering. */
  protected chosenId = signal<number | null>(null);

  /** What is in the search box. Holds the chosen video's name when nobody is
   * typing, so the box doubles as the display of the current choice. */
  protected query = signal('');

  protected options = computed<VideoOption[]>(() =>
    this.videoDatabase
      .videoRecords()
      .filter((record) => record.__id != null)
      .map((record) => ({
        id: record.__id!,
        name: record.sort_name || '(untitled)',
        note: scanNote(record),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** The options that match the query, best first, with the matched characters
   * split out for highlighting. */
  protected matches = computed<(VideoOption & { segments: HighlightSegment[] })[]>(() => {
    const query = this.query();
    // The box showing the current choice's own name is not a search: opening it
    // again should offer every video, not just the one already picked.
    const search = query === this.nameOf(this.chosenId()) ? '' : query;
    return rankFuzzy(this.options(), search, (option) => option.name).map(({ item, match }) => ({
      ...item,
      segments: highlight(item.name, match.indices),
    }));
  });

  protected chosen = computed(() => {
    const id = this.chosenId();
    if (id == null) return null;
    return this.videoDatabase.videoRecords().find((record) => record.__id === id) ?? null;
  });

  protected hint = computed(() => {
    if (this.options().length === 0) return 'No records yet - add some on the Import step.';
    const record = this.chosen();
    if (!record) return 'Choose a video to submit.';
    if (buildVideoFeatures(record))
      return "Sends this video's scanned features to the server's model.";
    return record.video_file.hash
      ? 'This video has not been fully scanned yet - submitting it will offer to scan it first.'
      : 'This video has not been scanned and has no video file attached, so it cannot be submitted yet.';
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

  /** An arrow so the autocomplete can call it detached, as [displayWith] does:
   * without it the panel writes the option's numeric id into the box. */
  protected nameOf = (id: number | null): string =>
    this.options().find((option) => option.id === id)?.name ?? '';

  /** A result belongs to the video it was asked about, so choosing another
   * clears it rather than leaving one video's numbers under another's name. */
  protected choose(id: number): void {
    this.chosenId.set(id);
    this.query.set(this.nameOf(id));
    this.result.set(null);
    this.status.set(null);
  }

  /** Closing the panel without choosing puts the box back to the current
   * choice, so half-typed text never reads as the video about to be sent. */
  protected restoreQuery(): void {
    this.query.set(this.nameOf(this.chosenId()));
  }

  async submit(): Promise<void> {
    const id = this.chosenId();
    const record = this.chosen();
    if (id == null || !record || this.pending()) return;

    this.status.set(null);
    this.result.set(null);

    const steps = missingScanSteps(record);
    if (!buildVideoFeatures(record) && !(await this.confirmScan(record, steps))) return;

    this.pending.set(true);
    let stage: 'scan' | 'request' = 'scan';
    try {
      if (!buildVideoFeatures(record)) await this.scan(record, steps);

      const features = buildVideoFeatures(record);
      if (!features) {
        this.status.set(
          'Scanning finished, but the video still lacks the scene and transcript stats the model needs - check its row on the Scan step.',
        );
        return;
      }
      if (!record.video_file.hash) {
        this.status.set('This video has no video file attached, so it cannot be submitted.');
        return;
      }

      stage = 'request';
      this.status.set(null);
      const result = await this.recommendationService.request(record.video_file.hash, features);
      // Dropped if the user chose another video while this was in flight.
      if (this.chosenId() === id) this.result.set(result);
    } catch (error) {
      console.error(`Recommendation ${stage} failed:`, error);
      const what = stage === 'scan' ? 'Could not scan this video' : 'Could not get recommendations';
      this.status.set(`${what}: ${describe(error)}`);
    } finally {
      this.pending.set(false);
    }
  }

  /** Opens the scan-first dialog; true only if the user chose to scan. */
  private async confirmScan(record: VideoRecord, steps: ScanStep[]): Promise<boolean> {
    const ref = this.dialog.open<ScanFirstDialogComponent, ScanFirstDialogData, boolean>(
      ScanFirstDialogComponent,
      {
        data: {
          name: record.sort_name || '(untitled)',
          steps,
          canScan: !!record.video_file.hash,
        },
      },
    );
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  /**
   * Runs the missing steps against the record in order, saving after each, as
   * the Scan step's bulk run does - so a scan that fails half way still keeps
   * what it finished, and the failure is recorded on the record too.
   */
  private async scan(record: VideoRecord, steps: ScanStep[]): Promise<void> {
    for (const [index, step] of steps.entries()) {
      this.status.set(`Scanning: ${SCAN_STEP_LABELS[step]} (${index + 1} of ${steps.length})...`);
      try {
        await this.runStep(record, step);
      } catch (error) {
        await this.videoDatabase.updateVideo(record).catch(() => undefined);
        throw error;
      }
      await this.videoDatabase.updateVideo(record);
    }
  }

  private async runStep(record: VideoRecord, step: ScanStep): Promise<void> {
    switch (step) {
      case 'sceneStats':
        return this.datasetActions.fetchSceneStats(record);
      case 'transcript':
        return this.datasetActions.fetchTranscript(record);
      case 'transcriptStats':
        return this.datasetActions.recomputeTranscriptStats(record);
    }
  }
}

/** What submitting this record will run into, shown beside it in the picker. */
const scanNote = (record: VideoRecord): string | null => {
  if (buildVideoFeatures(record)) return null;
  return record.video_file.hash ? 'not scanned' : 'not scanned, no video file';
};

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
