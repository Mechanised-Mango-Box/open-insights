import { Component, computed, inject } from '@angular/core';
import { ProcessingMode, ProcessingModeService } from './processing-mode.service';

/**
 * Where the work goes, on screen at all times.
 *
 * Sits above the Settings nav item rather than inside Settings, because the
 * settings that produce it are the ones you forget you changed - a server URL
 * pointed at localhost, or transcription left in the browser from last session.
 * Both alter the results, so neither should only be visible to someone who went
 * looking.
 */
@Component({
  selector: 'processing-mode-badge',
  standalone: true,
  template: `
    <span class="mode-badge" [class]="'mode-' + mode()" [title]="tooltip()">
      <span class="dot"></span>
      {{ label() }}
    </span>
  `,
  styles: [
    `
      /* The dot-plus-label shape of .correlation-badge in Analysis, boxed in so
         it reads as a status rather than as a heading for the item below it. */
      .mode-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
        background: var(--mat-sys-surface-container-high);
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 999px;
        padding: 3px 10px;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: none;
      }
      .mode-cloud .dot {
        background: var(--mat-sys-primary);
      }
      .mode-local .dot {
        background: var(--mat-sys-tertiary);
      }
      /* Coloured through, not just dotted: this is the same "not the normal
         path" signal the experimental callout in Settings uses, and it has to
         survive being skim-read. */
      .mode-experimental {
        color: var(--mat-sys-error);
        border-color: var(--mat-sys-error);
      }
      .mode-experimental .dot {
        background: var(--mat-sys-error);
      }
    `,
  ],
})
export class ProcessingModeBadgeComponent {
  private processingMode = inject(ProcessingModeService);

  protected readonly mode = this.processingMode.mode;

  protected readonly labels: Record<ProcessingMode, string> = {
    cloud: 'Cloud',
    local: 'Local',
    experimental: 'Experimental',
  };

  protected readonly label = computed(() => this.labels[this.mode()]);

  /** Names the actual place, so "Local" against a server that is not on this
   * machine - or a split across two - is never left ambiguous. */
  protected readonly tooltip = computed(() => `Work runs on: ${this.processingMode.detail()}`);
}
