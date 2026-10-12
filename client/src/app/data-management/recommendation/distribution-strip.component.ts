import { Component, computed, input } from '@angular/core';
import { TrainingHistogram } from './recommendation.service';
import { stripGeometry } from './training-comparison';

/**
 * A word-sized histogram of a model's training videos with one video marked on
 * it, to sit beside a number and say where that number falls.
 *
 * Plain positioned boxes rather than a chart: it is a glyph, not something to
 * read values off, and at this size a canvas would only add blur. Drawn in the
 * app's own theme tokens - unlike the Chart.js charts, which are a white island -
 * because it sits inline in running text on the dark page.
 */
@Component({
  selector: 'distribution-strip',
  standalone: true,
  template: `
    <span class="strip" role="img" [attr.aria-label]="label()" [title]="label()">
      @for (bar of geometry().bars; track $index) {
        <span
          class="bar"
          [style.left.%]="bar.x * 100"
          [style.width.%]="bar.width * 100"
          [style.height.%]="bar.height * 100"
        ></span>
      }
      <span
        class="marker"
        [class.below]="geometry().outside === 'below'"
        [class.above]="geometry().outside === 'above'"
        [style.left.%]="geometry().marker * 100"
      ></span>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        vertical-align: middle;
        width: 160px;
        max-width: 100%;
      }
      .strip {
        position: relative;
        display: block;
        height: 24px;
        border-bottom: 1px solid var(--mat-sys-outline-variant);
      }
      .bar {
        position: absolute;
        bottom: 0;
        box-sizing: border-box;
        /* A hairline of page between neighbours, so equal bars do not merge into a block. */
        padding: 0 1px;
        background: var(--mat-sys-outline);
        background-clip: content-box;
        opacity: 0.55;
        border-radius: 2px 2px 0 0;
      }
      .marker {
        position: absolute;
        top: -2px;
        bottom: -3px;
        width: 2px;
        margin-left: -1px;
        border-radius: 1px;
        background: var(--mat-sys-primary);
      }
      /* Off the training range: pinned to the end, with an arrow inside the strip
         pointing the way the value fell off it. */
      .marker.below::before,
      .marker.above::before {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        color: var(--mat-sys-primary);
        font-size: 12px;
        line-height: 1;
      }
      .marker.below::before {
        content: '◀';
        left: 4px;
      }
      .marker.above::before {
        content: '▶';
        right: 4px;
      }
    `,
  ],
})
export class DistributionStripComponent {
  histogram = input.required<TrainingHistogram>();
  value = input.required<number>();
  /** What the strip says, for screen readers and the hover title. */
  label = input.required<string>();

  protected geometry = computed(() => stripGeometry(this.histogram(), this.value()));
}
