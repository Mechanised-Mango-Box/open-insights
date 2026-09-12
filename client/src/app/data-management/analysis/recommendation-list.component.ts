import { Component, input } from '@angular/core';
import { Relationship } from './recommendations';

/** One feature's verdict, ready to render: the label is resolved by the caller
 * because only it knows whether the key came from a local fit or the server. */
export type RecommendationRow = {
  key: string;
  label: string;
  relationship: Relationship;
  recommendation: string;
};

/**
 * The list of "higher X is associated with ..." statements, shared by the
 * Analysis page (which fits the regression in the browser over the whole
 * dataset) and the Recommend page (which asks the server's model about one
 * video). Two places show the same verdicts, so they render through one
 * component rather than two copies that drift.
 *
 * Presentational only - no data fetching, no signals of its own. Whether there
 * are rows to show at all, and what to say when there are not, belongs to the
 * page, because the reasons differ between them.
 */
@Component({
  selector: 'recommendation-list',
  standalone: true,
  template: `
    <ul class="recommendation-list">
      @for (row of rows(); track row.key) {
        <li class="recommendation">
          <span class="relationship" [class]="'relationship-' + row.relationship">
            {{ row.relationship }}
          </span>
          <span class="recommendation-text">
            <strong>{{ row.label }}</strong>
            - {{ row.recommendation }}
          </span>
        </li>
      }
    </ul>
  `,
  styles: [
    `
      .recommendation-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .recommendation {
        display: flex;
        align-items: baseline;
        gap: 10px;
      }
      .relationship {
        flex: none;
        min-width: 64px;
        text-align: center;
        text-transform: uppercase;
        font-size: 0.7em;
        letter-spacing: 0.06em;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid currentColor;
      }
      .relationship-positive {
        color: #2a78d6;
      }
      .relationship-negative {
        color: #e34948;
      }
      .relationship-weak {
        color: var(--mat-sys-on-surface-variant);
      }
    `,
  ],
})
export class RecommendationListComponent {
  rows = input.required<RecommendationRow[]>();
}
