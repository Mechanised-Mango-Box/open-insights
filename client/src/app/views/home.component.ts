import { Component, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ViewId, WORKFLOW } from './views';
import { ServerChoiceCardComponent } from '../data-management/server-choice-card.component';

/**
 * The landing view, reached by clicking the app name in the sidebar. Opens on where the
 * compute happens - the one choice that has to be made before Scan does anything - then
 * lays the steps out in the order the sidebar lists them, each card jumping straight to
 * its step. The step icons and one-line blurbs come from WORKFLOW, so the cards can't
 * drift from the sidebar and the view headers.
 */
@Component({
  selector: 'home-overview',
  imports: [MatIcon, ServerChoiceCardComponent],
  template: `
    <div class="view-stack">
      <server-choice-card class="view-block" (navigate)="navigate.emit($event)" />

      <section class="card">
        <h2>The workflow</h2>
        <ol class="steps">
          @for (step of workflow; track step.id) {
            <li>
              <button class="step" (click)="navigate.emit(step.id)">
                <span class="step-top">
                  <mat-icon>{{ step.icon }}</mat-icon>
                  <span class="step-number">{{ $index + 1 }}</span>
                </span>
                <span class="step-label">{{ step.label }}</span>
                <span class="step-blurb">{{ step.blurb }}</span>
              </button>
            </li>
          }
        </ol>
      </section>

      <section class="card callout">
        <mat-icon>warning</mat-icon>
        <div>
          <h2>Analysis looking thin?</h2>
          <p>
            A record only counts toward it with <strong>all five</strong> of: scene stats, a
            transcript, screen text, audio stats, and a YouTube content report with its average view
            duration. The Analysis page lists how many records were left out and why. Recommend can
            ask for less - each model lists the scans it needs.
          </p>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .callout h2 {
        font: var(--mat-sys-title-medium);
        margin: 0 0 4px;
      }
      .card > h2 {
        margin-bottom: 12px;
      }
      p {
        margin: 0;
        max-width: 62ch;
      }
      /* An icon in a fixed column, so the text beside it lines up. */
      .callout {
        display: grid;
        grid-template-columns: 20px 1fr;
        gap: 10px;
        align-items: start;
      }
      .steps {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 12px;
        list-style: none;
        padding: 0;
        margin: 0;
      }
      /* The grid's rows already stretch; these carry that height down to the
         button, so a step with a shorter blurb is not a shorter card. */
      .steps > li {
        display: flex;
      }
      .step {
        flex: 1;
        display: grid;
        align-content: start;
        gap: 4px;
        width: 100%;
        text-align: left;
        padding: 12px;
        border-radius: 12px;
        background: var(--mat-sys-surface-container-high);
        border: 1px solid var(--mat-sys-outline-variant);
        color: inherit;
        cursor: pointer;
      }
      .step:hover {
        background: var(--mat-sys-surface-container-highest);
      }
      /* The icon leads, with the step's position in the run held to the far corner - the
         cards reflow onto one column on a narrow window, where the order stops being
         readable from the layout alone. */
      .step-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .step-number {
        font: var(--mat-sys-label-small);
        color: var(--mat-sys-on-surface-variant);
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 50%;
        width: 18px;
        height: 18px;
        display: grid;
        place-items: center;
      }
      .step-label {
        font: var(--mat-sys-title-small);
      }
      .step-blurb {
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
      }
      /* mat-icon's host box is a fixed 24px square, so the size has to be set on all three
         properties at once or the glyph outgrows its box. */
      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
      .step mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
        color: var(--mat-sys-primary);
      }
      /* The card's own surface, with the left edge in the primary colour to mark it
         as an aside rather than a step. */
      .callout {
        border-left: 3px solid var(--mat-sys-primary);
      }
    `,
  ],
})
export class HomeComponent {
  readonly workflow = WORKFLOW;

  navigate = output<ViewId>();
}
