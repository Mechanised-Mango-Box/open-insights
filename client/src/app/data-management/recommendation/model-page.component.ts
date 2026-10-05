import { Component, computed, inject, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ProcessingModeService } from '../processing-mode.service';
import { ServerConfigService } from '../server-config.service';
import { ModelDetailsComponent } from './model-details.component';
import { ModelSelectionService, neededScansLabel } from './model-selection.service';

/**
 * Recommend's first subpage: which of the server's models to ask, and everything
 * its card says about it. The choice is held by ModelSelectionService, so the
 * video subpage reads it without this page having to be open.
 */
@Component({
  selector: 'recommend-model-page',
  standalone: true,
  imports: [MatButtonModule, MatFormFieldModule, MatIcon, MatSelectModule, ModelDetailsComponent],
  template: `
    <section class="card actions-column">
      <mat-form-field class="model-picker" appearance="outline" subscriptSizing="dynamic">
        <mat-label>Model</mat-label>
        <mat-select
          [value]="selected()?.id"
          [disabled]="!models()"
          (selectionChange)="selection.choose($event.value)"
        >
          @for (model of models()?.models ?? []; track model.id) {
            <mat-option [value]="model.id" [disabled]="!model.compatible">
              {{ model.card?.name ?? model.id }}
              <span class="option-note">
                - {{ model.card?.features?.length ?? '?' }} features{{
                  model.default ? ', default' : ''
                }}{{ model.compatible ? '' : ', cannot be used: ' + model.problems[0] }}
              </span>
            </mat-option>
          }
        </mat-select>
      </mat-form-field>

      @if (error()) {
        <p class="action-hint">{{ error() }}</p>
      } @else if (loading() && !models()) {
        <p class="action-hint">Asking the server which models it has…</p>
      }
      @if (selected()) {
        <p class="action-hint">Scans it needs: {{ neededScans() }}.</p>
      }

      <div class="actions">
        <button
          mat-raised-button
          color="primary"
          [disabled]="!selected() && !error()"
          (click)="next.emit()"
        >
          <mat-icon>arrow_forward</mat-icon>
          Choose a Video
        </button>
        <button mat-stroked-button [disabled]="loading()" (click)="selection.refresh()">
          <mat-icon>refresh</mat-icon>
          Refresh Model List
        </button>
      </div>

      @if (isLocalServer()) {
        <p class="action-hint">
          Models are added on your server's own page:
          <a [href]="serverPage()" target="_blank" rel="noreferrer">{{ serverPage() }}</a>
        </p>
      }
    </section>

    @if (selected(); as model) {
      <section class="card">
        <h2>{{ model.card?.name ?? model.id }}</h2>
        <model-details [entry]="model" />
      </section>
    }
  `,
  styles: [
    `
      .model-picker {
        width: 100%;
        max-width: 640px;
      }
      .option-note {
        margin-left: 4px;
        color: var(--mat-sys-on-surface-variant);
      }
      h2 {
        margin-top: 0;
      }
      :host {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
    `,
  ],
})
export class ModelPageComponent {
  protected selection = inject(ModelSelectionService);
  private processingMode = inject(ProcessingModeService);
  private serverConfig = inject(ServerConfigService);

  /** Asked to move on to the video subpage. */
  next = output<void>();

  protected models = this.selection.models;
  protected loading = this.selection.loading;
  protected error = this.selection.error;
  protected selected = this.selection.selected;

  protected neededScans = computed(() => neededScansLabel(this.selection.features()));
  protected isLocalServer = computed(() => this.processingMode.mode() === 'local');
  protected serverPage = computed(() => `${this.serverConfig.serverUrl()}/#models`);
}
