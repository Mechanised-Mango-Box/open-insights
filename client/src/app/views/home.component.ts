import { Component, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ViewId, WORKFLOW } from './views';

/**
 * The landing view, reached by clicking the app name in the sidebar. Says what the tool is,
 * where the data and the compute each live, and lays the steps out in the order the sidebar
 * lists them - each card jumping straight to its step. The step icons and one-line blurbs
 * come from WORKFLOW, so the cards can't drift from the sidebar and the view headers.
 */
@Component({
  selector: 'home-overview',
  imports: [MatIcon],
  template: `
    <div class="home">
      <section class="setup">
        <div class="fact">
        </div>
        <div class="fact">
          <mat-icon>dns</mat-icon>
          <p>
            <strong>A dataset server does the compute.</strong> Point it at yours in
            <button class="jump" (click)="navigate.emit('settings')">Settings</button> - it defaults
            to <code>http://localhost:5000</code>. Scan and Analysis need it; Import and Export
            don't.
          </p>
        </div>
      </section>

      <section>
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

      <section class="callout">
        <mat-icon>warning</mat-icon>
        <div>
          <h2>Analysis looking thin?</h2>
          <p>
            A record only counts toward it with <strong>all three</strong> of: scene stats,
            transcript stats, and a YouTube average view duration.
          </p>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .home {
        /* Wide enough for the four step cards; the prose blocks keep their own measure. */
        max-width: 760px;
      }
      .lead {
        font: var(--mat-sys-body-large);
        max-width: 62ch;
        margin: 0 0 20px;
      }
      section {
        margin: 0 0 20px;
      }
      h2 {
        font: var(--mat-sys-title-medium);
        margin: 0 0 8px;
      }
      p {
        margin: 0;
        max-width: 62ch;
      }
      /* An icon in a fixed column, so the text beside each one lines up. */
      .fact,
      .callout {
        display: grid;
        grid-template-columns: 20px 1fr;
        gap: 10px;
        align-items: start;
      }
      .fact {
        margin-bottom: 8px;
      }
      .steps {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 12px;
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .step {
        display: grid;
        gap: 4px;
        width: 100%;
        text-align: left;
        padding: 12px;
        border-radius: 12px;
        background: var(--mat-sys-surface-container);
        border: 1px solid var(--mat-sys-outline-variant);
        color: inherit;
        cursor: pointer;
      }
      .step:hover {
        background: var(--mat-sys-surface-container-high);
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
      code {
        font-family: monospace;
        background: var(--mat-sys-surface-container-high);
        border-radius: 4px;
        padding: 1px 5px;
      }
      /* A step name that reads as part of the sentence but jumps to that step. */
      .jump {
        appearance: none;
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        color: var(--mat-sys-primary);
        text-decoration: underline;
        cursor: pointer;
      }
      .callout {
        background: var(--mat-sys-surface-container);
        border-left: 3px solid var(--mat-sys-primary);
        border-radius: 4px;
        padding: 16px;
      }
    `,
  ],
})
export class HomeComponent {
  readonly workflow = WORKFLOW;

  navigate = output<ViewId>();
}
