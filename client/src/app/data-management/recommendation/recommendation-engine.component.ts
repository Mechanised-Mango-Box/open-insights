import { Component, computed, effect, inject, output, signal, untracked } from '@angular/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { DatasetActionsService } from '../video-records/dataset-actions.service';
import { VideoDatabaseService } from '../video-records/video-database.service';
import { VideoRecord } from '../video-records/VideoRecord';
import { buildFeaturesFor } from '../analysis/analysis.service';
import { AnalysisFeatureColumn, FEATURE_LABELS, isFeatureColumn } from '../analysis/stats';
import { ModelSelectionService, neededScansLabel } from './model-selection.service';
import {
  RecommendationListComponent,
  RecommendationRow,
} from '../analysis/recommendation-list.component';
import { HighlightSegment, highlight, rankFuzzy } from './fuzzy';
import {
  FeatureDistribution,
  RecommendationService,
  Suggestion,
  VideoRecommendation,
} from './recommendation.service';
import { DistributionStripComponent } from './distribution-strip.component';
import { TrainingComparisonChartComponent } from './training-comparison-chart.component';
import { ordinal, percentileSentence, viewingSentence } from './training-comparison';
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
  /** Where the value sits among the training videos, when the model can say. */
  placement: Placement | null;
};

/** One feature of this video placed against the model's training videos. */
type Placement = {
  distribution: FeatureDistribution;
  percentile: number;
  sentence: string;
};

/** A row of the training comparison: one feature, ready to strip and chart. */
type Comparison = Placement & {
  key: string;
  label: string;
  value: number;
  curve?: { x: number[]; apv: number[] };
};

/** One entry in the video picker. Every record is choosable; the note only says
 * what submitting it will run into. */
type VideoOption = {
  id: number;
  name: string;
  note: string | null;
};

/**
 * Recommend's second subpage: hands one video to the model chosen on the first
 * (ModelPageComponent), and shows its predicted performance and where it could
 * improve.
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
    MatExpansionModule,
    MatFormFieldModule,
    MatIcon,
    MatInputModule,
    DistributionStripComponent,
    RecommendationListComponent,
    TrainingComparisonChartComponent,
  ],
  template: `
    <div class="view-stack">
      <section class="card actions-column">
        <div class="actions model-summary">
          <span>
            Model: <strong>{{ modelName() }}</strong>
            @if (selectedModel()?.card; as card) {
              <span class="option-note">
                - {{ card.features.length }} features; needs {{ neededScans() }}
              </span>
            }
          </span>
          <button mat-button [disabled]="pending()" (click)="changeModel.emit()">
            <mat-icon>swap_horiz</mat-icon>
            Change
          </button>
        </div>
        @if (modelError()) {
          <p class="action-hint">{{ modelError() }}</p>
        } @else if (modelSelection.unusable(); as reason) {
          <p class="method-warning">{{ reason }}</p>
        }

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
          @if (targetPlacement(); as target) {
            <p class="placement">
              <distribution-strip
                [histogram]="target.histogram"
                [value]="result.average_percentage_viewed"
                [label]="'Predicted viewing: ' + target.sentence"
              />
              <span>That is {{ target.sentence }}.</span>
            </p>
          }
          <p class="card-lead">
            From {{ answeredBy() }} on the dataset server, not from your own records - the Analysis
            step is the one that reports on those.
            @if (selectedModel()?.card; as card) {
              It learned from {{ card.training.rows }} videos, and on the ones held out from its
              training it was typically {{ number(card.metrics.random_forest?.rmse ?? 0) }} points
              out. The Model tab has its full card.
            }
          </p>
        </section>

        <section class="card">
          <h2>Where this video could improve</h2>
          @if (improvements().length === 0) {
            <p class="card-lead">
              Nothing stands out: wherever the model sees a meaningful relationship, this video
              already sits on the side of the training average associated with higher viewing.
            </p>
          } @else {
            <p class="card-lead">
              Largest estimated cost first. These are associations in the training data, not a
              promise that changing one will raise viewing.
            </p>
            <ul class="improvement-list">
              @for (item of improvements(); track item.key) {
                <li class="improvement">
                  <span class="direction">{{ item.suggestion }}</span>
                  <strong class="improvement-label">{{ item.label }}</strong>
                  <span class="cost" title="Estimated effect on average percentage viewed">
                    {{ number(item.contribution) }} points
                  </span>
                  <div class="improvement-body">
                    <div class="improvement-values">
                      {{ number(item.value) }} in this video · training average
                      {{ number(item.trainingMean) }}
                    </div>
                    @if (item.placement; as placement) {
                      <div class="placement">
                        <distribution-strip
                          [histogram]="placement.distribution.histogram"
                          [value]="item.value"
                          [label]="item.label + ': ' + placement.sentence"
                        />
                        <span>{{ placement.sentence }}</span>
                      </div>
                    }
                    <p class="advice">{{ item.advice }}</p>
                  </div>
                </li>
              }
            </ul>
          }
        </section>

        <section class="card">
          <h2>Compared with the training videos</h2>
          @if (comparisons().length === 0) {
            <p class="card-lead">
              This model's card has no summary of the videos it was trained on, so this video cannot
              be placed against them. Models trained before that summary was recorded lack it;
              retraining with the current scripts/train_engagement_model.py adds one.
            </p>
          } @else {
            <p class="card-lead">
              Each of this video's values among the {{ trainingRows() }} videos the model trained
              on. Choose one to see what training videos at each value typically got, and what the
              model expects for this video if only that value changed.
            </p>
            <div class="comparison-list" role="radiogroup" aria-label="Feature to chart">
              @for (row of comparisons(); track row.key) {
                <button
                  type="button"
                  class="comparison-row"
                  role="radio"
                  [class.selected]="row.key === shown()?.key"
                  [attr.aria-checked]="row.key === shown()?.key"
                  (click)="chartedKey.set(row.key)"
                >
                  <span class="comparison-label">{{ row.label }}</span>
                  <span class="comparison-value">{{ number(row.value) }}</span>
                  <distribution-strip
                    [histogram]="row.distribution.histogram"
                    [value]="row.value"
                    [label]="row.label + ': ' + row.sentence"
                  />
                  <span class="comparison-sentence">{{ row.sentence }}</span>
                </button>
              }
            </div>
            @if (shown(); as row) {
              <h3>{{ row.label }}</h3>
              <training-comparison-chart
                [label]="row.label"
                [distribution]="row.distribution"
                [value]="row.value"
                [prediction]="result.average_percentage_viewed"
                [curve]="row.curve"
              />
              <p class="card-lead chart-note">
                The shaded band is where the middle half of the training videos at each value
                landed, and the solid line their median; bins with fewer than
                {{ minVideosPerBin() }} videos are left blank. The dashed line is the model's
                prediction for this video with only {{ row.label.toLowerCase() }} changed - what it
                would expect, not a promise of what changing the video will do.
              </p>
            }
          }
        </section>

        <section class="card">
          <h2>What the model learned across its training data</h2>
          <recommendation-list [rows]="rows()" />
        </section>

        <mat-expansion-panel>
          <mat-expansion-panel-header>
            <mat-panel-title>How this result is calculated</mat-panel-title>
          </mat-expansion-panel-header>
          <dl class="method-list">
            <dt>Prediction</dt>
            <dd>
              The model's random forest
              @if (trees(); as trees) {
                ({{ trees }} decision trees)
              }
              predicts average percentage viewed from this video's raw feature values; the result is
              the mean of its trees' predictions, not clipped to 0-100.
            </dd>
            <dt>Relationships</dt>
            <dd>
              A linear regression fitted to the same training videos, after standardising each
              feature to a z-score. A coefficient is the change in average percentage viewed per
              standard deviation of that feature. At or above +{{ result.threshold }} it reads as
              positive, at or below -{{ result.threshold }} as negative, and in between as weak - a
              practical-effect threshold set by the model, not a significance test.
            </dd>
            <dt>Where this video sits</dt>
            <dd>
              z = (value - training mean) / training SD. Contribution = coefficient x z: how many
              points this value moves the linear estimate away from an average training video.
            </dd>
            <dt>Compared with the training videos</dt>
            <dd>
              Percentile: roughly the share of the model's training videos with a lower value, read
              off their 5% quantiles. The typical band and line: the 25th, 50th and 75th percentiles
              of average percentage viewed among the training videos in each histogram bin. The
              expected line: the random forest's prediction for this video with that one feature
              moved across the training range and every other feature left as it is - so it passes
              through this video's own prediction.
            </dd>
            <dt>Suggestions</dt>
            <dd>
              Increase when the relationship is positive and z is below 0; decrease when it is
              negative and z is above 0; keep when the value is already on the better side; none
              when the relationship is weak. Listed by contribution, most negative first.
            </dd>
          </dl>
          <table class="method-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Value</th>
                <th>Training mean</th>
                <th>Training SD</th>
                <th>z</th>
                <th>Coefficient</th>
                <th>Contribution</th>
                <th>Percentile</th>
              </tr>
            </thead>
            <tbody>
              @for (row of workings(); track row.key) {
                <tr>
                  <td>{{ row.label }}</td>
                  <td>{{ number(row.value) }}</td>
                  <td>{{ number(row.training_mean) }}</td>
                  <td>{{ row.training_sd == null ? '-' : number(row.training_sd) }}</td>
                  <td>{{ number(row.z_score) }}</td>
                  <td>{{ number(row.coefficient) }}</td>
                  <td>{{ number(row.contribution) }}</td>
                  <td>
                    {{
                      row.training_percentile == null
                        ? '-'
                        : ordinal(Math.round(row.training_percentile))
                    }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </mat-expansion-panel>
      }
    </div>
  `,
  styles: [
    `
      /* A line of context with its edit link, not one of the step's stacked actions:
         a text button at its own width, so it does not take the 300px floor the
         action buttons below share and read as their peer. */
      .actions.model-summary {
        gap: 4px 8px;
      }
      .actions.model-summary > button {
        min-width: 0;
      }
      .video-picker {
        width: 100%;
        max-width: 640px;
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
      }
      /* Each item reads as a heading row - what to change, which feature, what it
         is estimated to cost - with the detail indented under the feature's name. */
      .improvement {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 6px 12px;
        padding: 14px 0;
      }
      .improvement + .improvement {
        border-top: 1px solid var(--mat-sys-outline-variant);
      }
      .improvement:first-child {
        padding-top: 4px;
      }
      .improvement:last-child {
        padding-bottom: 0;
      }
      .improvement-label {
        font: var(--mat-sys-title-small);
      }
      .cost {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .improvement-body {
        grid-column: 2 / -1;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      /* A fixed width, not a minimum: every item is its own grid, so the pill has
         to be the same size in each for the feature names to line up. */
      .direction {
        width: 84px;
        box-sizing: border-box;
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
      .improvement-values,
      .advice {
        color: var(--mat-sys-on-surface-variant);
      }
      .advice {
        margin: 0;
        font: var(--mat-sys-body-small);
      }
      .placement {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
      }
      .comparison-list {
        display: flex;
        flex-direction: column;
        margin-bottom: 16px;
      }
      /* A row is a button so the whole of it chooses the chart; dressed as a row. */
      .comparison-row {
        display: grid;
        grid-template-columns: minmax(120px, 1fr) 72px 160px minmax(160px, 1.4fr);
        align-items: center;
        gap: 4px 16px;
        padding: 8px 12px;
        border: 0;
        border-left: 3px solid transparent;
        border-radius: 8px;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .comparison-row:hover {
        background: color-mix(in srgb, var(--mat-sys-on-surface) 6%, transparent);
      }
      .comparison-row:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }
      .comparison-row.selected {
        border-left-color: var(--mat-sys-primary);
        background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      }
      .comparison-value {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .comparison-sentence {
        color: var(--mat-sys-on-surface-variant);
      }
      .chart-note {
        margin-top: 12px;
      }
      /* Phone width: name and value on one line, the strip and its sentence under them. */
      @media (max-width: 600px) {
        .improvement-body {
          grid-column: 1 / -1;
        }
        .improvement distribution-strip {
          width: 100%;
        }
        .comparison-row {
          grid-template-columns: 1fr auto;
        }
        .comparison-row distribution-strip,
        .comparison-sentence {
          grid-column: 1 / -1;
        }
        .comparison-row distribution-strip {
          width: 100%;
        }
      }
    `,
  ],
})
export class RecommendationEngineComponent {
  private videoDatabase = inject(VideoDatabaseService);
  private datasetActions = inject(DatasetActionsService);
  private recommendationService = inject(RecommendationService);
  protected modelSelection = inject(ModelSelectionService);
  private dialog = inject(MatDialog);

  /** Asked to go back to the model subpage. */
  changeModel = output<void>();

  protected modelError = this.modelSelection.error;
  protected selectedModel = this.modelSelection.selected;
  /** The features the chosen model scores, which decide what Scan has to supply. */
  private modelFeatures = this.modelSelection.features;

  protected modelName = computed(() => {
    const model = this.selectedModel();
    if (model) return model.card?.name ?? model.id;
    if (this.modelSelection.unusable()) return 'none usable';
    return this.modelError() ? "the server's built-in model" : 'loading…';
  });

  protected neededScans = computed(() => neededScansLabel(this.modelFeatures()));

  /** By id, so a refreshed model list (new objects, same models) clears nothing. */
  private selectedModelId = computed(() => this.selectedModel()?.id);

  constructor() {
    // A result belongs to the model that produced it, as it does to the video, so
    // choosing another model on the other subpage clears it.
    effect(() => {
      this.selectedModelId();
      untracked(() => {
        this.result.set(null);
        this.status.set(null);
        this.chartedKey.set(null);
      });
    });
  }

  protected answeredBy = computed(() => {
    const model = this.result()?.model;
    return model?.name ? `the ${model.name} model` : 'the model held';
  });

  protected trees = computed(() => {
    const value = this.selectedModel()?.card?.hyperparameters['n_estimators'];
    return typeof value === 'number' ? value : null;
  });

  protected readonly Math = Math;
  protected readonly ordinal = ordinal;

  private distribution = computed(() => this.selectedModel()?.card?.training_distribution ?? null);
  protected trainingRows = computed(() => this.distribution()?.rows ?? 0);
  protected minVideosPerBin = computed(() => this.distribution()?.min_videos_per_bin ?? 0);

  /** The feature chosen to chart, or null for the default. */
  protected chartedKey = signal<string | null>(null);

  /** Where a feature's value sits among the training videos, or null when this
   * model's card or the server's answer cannot say. */
  private placementFor(key: string, percentile: number | undefined): Placement | null {
    const distribution = this.distribution();
    const feature = distribution?.features[key];
    if (!distribution || !feature || percentile == null) return null;
    return {
      distribution: feature,
      percentile,
      sentence: percentileSentence(percentile, distribution.rows),
    };
  }

  protected targetPlacement = computed(() => {
    const distribution = this.distribution();
    const percentile = this.result()?.target_percentile;
    if (!distribution || percentile == null) return null;
    return {
      histogram: distribution.target.histogram,
      sentence: viewingSentence(percentile, distribution.rows),
    };
  });

  protected comparisons = computed<Comparison[]>(() =>
    Object.entries(this.result()?.features ?? {}).flatMap(([key, f]) => {
      const placement = this.placementFor(key, f.training_percentile);
      return placement
        ? [{ ...placement, key, label: labelFor(key), value: f.value, curve: f.expected_curve }]
        : [];
    }),
  );

  /** The charted row: the one chosen, else the costliest improvement, else the first. */
  protected shown = computed<Comparison | null>(() => {
    const rows = this.comparisons();
    const wanted = this.chartedKey() ?? this.improvements()[0]?.key;
    return rows.find((row) => row.key === wanted) ?? rows[0] ?? null;
  });

  protected workings = computed(() =>
    Object.entries(this.result()?.features ?? {}).map(([key, f]) => ({
      key,
      label: labelFor(key),
      ...f,
    })),
  );

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
        note: scanNote(record, this.modelFeatures()),
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
    if (buildFeaturesFor(record, this.modelFeatures()))
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
        placement: this.placementFor(key, f.training_percentile),
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
      coefficient: f.coefficient,
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
    this.chartedKey.set(null);
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
    this.chartedKey.set(null);

    // Fixed for the whole submit, so a model changed mid-scan cannot be sent
    // features computed for another one.
    const columns = this.modelFeatures();
    const modelId = this.selectedModel()?.id;
    const steps = missingScanSteps(record, columns);
    if (!buildFeaturesFor(record, columns) && !(await this.confirmScan(record, steps))) return;

    this.pending.set(true);
    let stage: 'scan' | 'request' = 'scan';
    try {
      if (!buildFeaturesFor(record, columns)) await this.scan(record, steps);

      const features = buildFeaturesFor(record, columns);
      if (!features) {
        this.status.set(
          'Scanning finished, but the video still lacks a stat this model needs - check its row on the Scan step. If its speech never paused (one unbroken stretch, or music under the voice), it has no mean pause, so only a model that leaves mean pause out can score it.',
        );
        return;
      }
      if (!record.video_file.hash) {
        this.status.set('This video has no video file attached, so it cannot be submitted.');
        return;
      }

      stage = 'request';
      this.status.set(null);
      const result = await this.recommendationService.request(
        record.video_file.hash,
        features,
        modelId,
      );
      // Dropped if the user chose another video or model while this was in flight.
      if (this.chosenId() === id && this.selectedModelId() === modelId) this.result.set(result);
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
      case 'textStats':
        return this.datasetActions.fetchTextStats(record);
      case 'audioStats':
        return this.datasetActions.fetchAudioStats(record);
    }
  }
}

/** What submitting this record will run into, shown beside it in the picker. */
const scanNote = (record: VideoRecord, columns: AnalysisFeatureColumn[]): string | null => {
  if (buildFeaturesFor(record, columns)) return null;
  return record.video_file.hash ? 'not scanned' : 'not scanned, no video file';
};

const labelFor = (key: string): string => (isFeatureColumn(key) ? FEATURE_LABELS[key] : key);

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
