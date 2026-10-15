import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ProcessingModeService } from '../processing-mode.service';
import { ServerConfigService } from '../server-config.service';
import { ModelSelectionService, neededScansLabel } from '../recommendation/model-selection.service';
import {
  ModelEntry,
  RecommendationService,
  TrainModelResult,
} from '../recommendation/recommendation.service';
import { VideoRecord } from '../video-records/VideoRecord';
import { buildTrainingManifest } from '../video-records/manifest-export';
import {
  MIN_TRAINING_ROWS,
  MODEL_ID_PATTERN,
  PRESET_LABELS,
  describeTrainError,
  matchingPreset,
  slugify,
  trainableCount,
} from './create-model';
import {
  ANALYSIS_FEATURE_COLUMNS,
  AnalysisFeatureColumn,
  FEATURE_DEFINITIONS,
  FEATURE_LABELS,
  FEATURE_PRESETS,
  FeaturePreset,
} from './stats';

export type CreateModelDialogData = {
  /** The records the analysis ran over: the selection, or every record. */
  records: VideoRecord[];
};

/** Closes with the new model, and whether to go and try it on a video. Closes
 * with nothing when cancelled. */
export type CreateModelDialogResult = { model: ModelEntry; tryIt: boolean };

/** Lite first: the set the server's own default model uses. */
const PRESET_ORDER: FeaturePreset[] = ['lite', 'all', 'video', 'audio'];

/**
 * Trains a model on the server from the records an analysis covered, then makes
 * it the model Recommend asks.
 *
 * The server does the training - a model is a scikit-learn pickle, which only it
 * can build - from the records' Scan results and average view durations alone
 * (buildTrainingManifest). The new model is an ordinary added model: listed to
 * everyone using that server, and chosen on Recommend's Model page like any other.
 */
@Component({
  selector: 'create-model-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    @if (result(); as done) {
      <h2 mat-dialog-title>Created {{ done.model.card?.name ?? done.model.id }}</h2>

      <mat-dialog-content>
        <p>
          It learned from {{ done.used_rows }} of {{ data.records.length }} record(s), and is now
          the model Recommend asks.
          @if (heldOut(); as m) {
            On the records it held back for testing, its prediction of average percentage viewed was
            off by {{ m.rmse.toFixed(1) }} points (RMSE), with an R² of {{ m.r2.toFixed(2) }}.
          }
        </p>
        @if (skipped().length) {
          <p class="note">
            Left out:
            @for (s of skipped(); track s.reason; let last = $last) {
              {{ s.count }} {{ s.reason }}{{ last ? '.' : ',' }}
            }
          </p>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-stroked-button type="button" (click)="close(false)">Done</button>
        <button mat-raised-button color="primary" type="button" (click)="close(true)">
          Try It on a Video
        </button>
      </mat-dialog-actions>
    } @else {
      <h2 mat-dialog-title>Create a model</h2>

      <mat-dialog-content>
        <p class="lead">
          Trains a model on the {{ data.records.length }} record(s) this analysis covered, and keeps
          it on <code>{{ serverUrl() }}</code> for Recommend.
          @if (sharedServer()) {
            That is the shared server: everyone using it will see this model and its card.
          }
          Only the Scan results and average view durations are sent - no titles or video files.
        </p>

        <h3>Features</h3>
        <p class="note">
          What the model learns from. Start from one of the server's own feature sets, then tick or
          untick any feature.
        </p>
        <div class="presets">
          @for (option of presets; track option.id) {
            <button
              mat-stroked-button
              type="button"
              [class.current]="preset() === option.id"
              [attr.aria-pressed]="preset() === option.id"
              (click)="usePreset(option.id)"
            >
              {{ option.name }}
            </button>
          }
        </div>
        @if (preset(); as id) {
          <p class="note">{{ presetLabels[id].description }}</p>
        }

        <div class="features">
          @for (feature of featureOptions; track feature.key) {
            <mat-checkbox [checked]="chosen().has(feature.key)" (change)="toggle(feature.key)">
              {{ feature.label }}
              <span class="definition">{{ feature.definition }}</span>
            </mat-checkbox>
          }
        </div>

        @if (features().length === 0) {
          <p class="method-warning">Choose at least one feature.</p>
        } @else {
          <p class="summary">
            {{ features().length }} feature(s). Needs {{ neededScans() }}. Usable: {{ usable() }} of
            {{ data.records.length }} record(s).
          </p>
          @if (usable() < minRows) {
            <p class="method-warning">
              A model needs at least {{ minRows }} records with these Scan results and a YouTube
              content report. Scan more videos and import their content report, or choose features
              from scans they already have.
            </p>
          }
        }

        <h3>About it</h3>
        <div class="fields">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Name</mat-label>
            <input matInput required maxlength="100" [value]="name()" (input)="onName($event)" />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Id</mat-label>
            <input matInput required maxlength="64" [value]="id()" (input)="onId($event)" />
            <!-- A hint rather than mat-error: there is no form control here for
                 mat-error to read its state from. -->
            <mat-hint [class.invalid]="id() !== '' && !idValid()">
              Lower-case letters, digits, - and _, starting with a letter or digit. Must be new to
              this server.
            </mat-hint>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Description</mat-label>
            <input
              matInput
              maxlength="1000"
              placeholder="What it is for"
              [value]="description()"
              (input)="description.set(value($event))"
            />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Notes</mat-label>
            <textarea
              matInput
              rows="2"
              maxlength="2000"
              placeholder="What it was trained on, and what that means for using it"
              [value]="notes()"
              (input)="notes.set(value($event))"
            ></textarea>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Provider</mat-label>
            <input
              matInput
              maxlength="100"
              placeholder="Who trained it"
              [value]="provider()"
              (input)="provider.set(value($event))"
            />
          </mat-form-field>
        </div>

        @if (cannotTrain()) {
          <p class="method-warning">{{ cannotTrain() }}</p>
        }
        @if (error()) {
          <p class="method-warning">{{ error() }}</p>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-stroked-button type="button" mat-dialog-close [disabled]="pending()">
          Cancel
        </button>
        <button
          mat-raised-button
          color="primary"
          type="button"
          [disabled]="!canSubmit()"
          (click)="train()"
        >
          {{ pending() ? 'Training…' : 'Train Model' }}
        </button>
      </mat-dialog-actions>
    }
  `,
  styles: [
    `
      .lead,
      .note {
        color: var(--mat-sys-on-surface-variant);
        margin: 0 0 12px;
      }
      h3 {
        font: var(--mat-sys-title-small);
        margin: 16px 0 8px;
      }
      .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 8px;
      }
      /* The set the ticked features add up to, if any - so a preset reads as a
         starting point the ticks then move away from. */
      .presets .current {
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
      }
      .features {
        display: flex;
        flex-direction: column;
      }
      .definition {
        display: block;
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
      }
      .summary {
        margin: 8px 0 0;
      }
      .invalid {
        color: var(--mat-sys-error);
      }
      .fields {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      code {
        font-family: monospace;
        background: var(--mat-sys-surface-container-high);
        padding: 0 4px;
        border-radius: 4px;
      }
    `,
  ],
})
export class CreateModelDialogComponent {
  protected data = inject<CreateModelDialogData>(MAT_DIALOG_DATA);
  private dialogRef =
    inject<MatDialogRef<CreateModelDialogComponent, CreateModelDialogResult>>(MatDialogRef);
  private recommendationService = inject(RecommendationService);
  private selection = inject(ModelSelectionService);
  private serverConfig = inject(ServerConfigService);
  private processingMode = inject(ProcessingModeService);

  protected readonly minRows = MIN_TRAINING_ROWS;
  protected readonly serverUrl = this.serverConfig.serverUrl;
  protected readonly sharedServer = computed(() => this.processingMode.mode() === 'cloud');

  protected readonly presetLabels = PRESET_LABELS;
  protected readonly presets = PRESET_ORDER.map((id) => ({ id, ...PRESET_LABELS[id] }));
  protected readonly featureOptions = ANALYSIS_FEATURE_COLUMNS.map((key) => ({
    key,
    label: FEATURE_LABELS[key],
    definition: FEATURE_DEFINITIONS[key],
  }));

  protected chosen = signal<ReadonlySet<AnalysisFeatureColumn>>(new Set(FEATURE_PRESETS.lite));
  /** The ticked features in the server's column order, whatever order they were ticked in. */
  protected features = computed(() => ANALYSIS_FEATURE_COLUMNS.filter((f) => this.chosen().has(f)));
  /** The preset the ticks add up to, or null once they match none. */
  protected preset = computed(() => matchingPreset(this.features()));
  protected neededScans = computed(() => neededScansLabel(this.features()));
  protected name = signal('');
  protected id = signal('');
  /** Until the id is typed in, it follows the name. */
  private idEdited = signal(false);
  protected description = signal('');
  protected notes = signal('');
  protected provider = signal('');

  protected pending = signal(false);
  protected error = signal<string | null>(null);
  protected result = signal<TrainModelResult | null>(null);

  protected usable = computed(() => trainableCount(this.data.records, this.features()));
  protected idValid = computed(() => MODEL_ID_PATTERN.test(this.id()));

  /** Why this server will not take a model, before anyone fills the form in. */
  protected cannotTrain = computed(() => {
    const list = this.selection.models();
    if (list?.can_train === false) return 'This server has training models turned off.';
    if (list && list.can_train === undefined) {
      return 'This server is too old to train models. Update it, or use another.';
    }
    return null;
  });

  protected canSubmit = computed(
    () =>
      !this.pending() &&
      !this.cannotTrain() &&
      this.features().length > 0 &&
      this.usable() >= MIN_TRAINING_ROWS &&
      this.name().trim() !== '' &&
      this.idValid(),
  );

  protected heldOut = computed(() => this.result()?.model.card?.metrics.random_forest ?? null);
  protected skipped = computed(() =>
    Object.entries(this.result()?.skipped ?? {}).map(([reason, count]) => ({ reason, count })),
  );

  protected usePreset(id: FeaturePreset): void {
    this.chosen.set(new Set(FEATURE_PRESETS[id]));
  }

  protected toggle(feature: AnalysisFeatureColumn): void {
    const next = new Set(this.chosen());
    if (!next.delete(feature)) next.add(feature);
    this.chosen.set(next);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected onName(event: Event): void {
    this.name.set(this.value(event));
    if (!this.idEdited()) this.id.set(slugify(this.name()));
  }

  protected onId(event: Event): void {
    this.id.set(this.value(event).trim());
    // Clearing the id hands it back to the name.
    this.idEdited.set(this.id() !== '');
    if (!this.idEdited()) this.id.set(slugify(this.name()));
  }

  async train(): Promise<void> {
    if (!this.canSubmit()) return;
    this.pending.set(true);
    this.error.set(null);
    this.dialogRef.disableClose = true;
    try {
      const result = await this.recommendationService.trainModel({
        manifest: buildTrainingManifest(this.data.records),
        features: this.features(),
        meta: {
          id: this.id(),
          name: this.name().trim(),
          description: this.description().trim(),
          notes: this.notes().trim(),
          provider: { name: this.provider().trim() },
        },
      });
      // Listed first, so the choice resolves to it rather than falling back.
      await this.selection.refresh();
      this.selection.choose(result.model.id);
      this.result.set(result);
    } catch (error) {
      this.error.set(describeTrainError(error));
    } finally {
      this.pending.set(false);
      // Once there is a model, only Done or Try It closes this, so the page
      // behind always hears about it.
      this.dialogRef.disableClose = this.result() !== null;
    }
  }

  protected close(tryIt: boolean): void {
    const model = this.result()?.model;
    this.dialogRef.close(model ? { model, tryIt } : undefined);
  }
}
