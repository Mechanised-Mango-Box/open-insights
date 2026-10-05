import { Component, computed, input } from '@angular/core';
import { FEATURE_DEFINITIONS, FEATURE_LABELS, isFeatureColumn } from '../analysis/stats';
import { ModelEntry } from './recommendation.service';

/**
 * A model's card, as its provider wrote it: what it is, who made it, what it
 * learned from, how well it did on videos it never saw, and what each input means.
 *
 * Presentational only. Everything here comes from the server's model.json, so
 * this never claims anything about a model the model's own card does not.
 */
@Component({
  selector: 'model-details',
  standalone: true,
  template: `
    @if (entry().card; as card) {
      @if (card.description) {
        <p class="method-note">{{ card.description }}</p>
      }
      @if (poorFit()) {
        <p class="method-warning">
          On the videos held out from its training, this model predicted worse than always guessing
          the average (R² {{ fixed(card.metrics.random_forest?.r2) }}). Treat its predictions as
          noise.
        </p>
      }
      <dl class="method-list">
        <dt>Provider</dt>
        <dd>
          @if (providerUrl(); as url) {
            <a [href]="url" target="_blank" rel="noreferrer">{{ card.provider.name || url }}</a>
          } @else {
            {{ card.provider.name || 'Not stated' }}
          }
        </dd>
        @if (card.notes) {
          <dt>Provider notes</dt>
          <dd>{{ card.notes }}</dd>
        }
        <dt>Version</dt>
        <dd>
          {{ card.version }} · id <code>{{ card.id }}</code> · {{ sourceLabel() }}
        </dd>
        <dt>Trained</dt>
        <dd>{{ created() }}</dd>
        <dt>Model type</dt>
        <dd>
          {{ card.model_type.predictor }} - {{ card.model_type.predictor_role }}<br />
          {{ card.model_type.feedback }} - {{ card.model_type.feedback_role }}
        </dd>
        <dt>Training data</dt>
        <dd>
          {{ card.training.rows }} videos from {{ card.training.dataset || 'an unnamed export' }}.
          {{ card.training.train_rows }} trained the model and {{ card.training.test_rows }} were
          held out to test it ({{ card.training.split }} Seed {{ card.training.random_state }}.)
        </dd>
        <dt>Held-out accuracy</dt>
        <dd>
          @if (card.metrics.random_forest; as m) {
            Random forest: RMSE {{ fixed(m.rmse) }} points, R² {{ fixed(m.r2) }}<br />
          }
          @if (card.metrics.linear_regression; as m) {
            Linear regression: RMSE {{ fixed(m.rmse) }} points, R² {{ fixed(m.r2) }}
          }
          <div class="hint">
            RMSE is the typical prediction error in percentage points of viewing; R² is the share of
            the variation between videos it explains (1 is perfect, 0 is no better than the
            average).
          </div>
        </dd>
        <dt>Target</dt>
        <dd>{{ card.target_definition }}</dd>
        <dt>Settings</dt>
        <dd>
          Relationship threshold {{ card.recommendation_threshold }} points of viewing per standard
          deviation. Forest: {{ hyperparameters() }}.
        </dd>
        <dt>Built with</dt>
        <dd>{{ framework() }}</dd>
      </dl>

      <h3 class="method-heading">Features ({{ card.features.length }})</h3>
      <table class="method-table">
        <thead>
          <tr>
            <th>Feature</th>
            <th>How it is computed</th>
            <th>Importance</th>
          </tr>
        </thead>
        <tbody>
          @for (row of featureRows(); track row.key) {
            <tr>
              <td>{{ row.label }}</td>
              <td>{{ row.definition }}</td>
              <td>{{ row.importance }}</td>
            </tr>
          }
        </tbody>
      </table>
      <p class="method-note">
        Importance is the random forest's impurity-based share of each feature in its splits; they
        add up to 1.
      </p>
    } @else {
      <p class="method-warning">
        This model's card could not be read: {{ entry().problems.join(' ') }}
      </p>
    }
  `,
  styles: [
    `
      .hint {
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-body-small);
      }
    `,
  ],
})
export class ModelDetailsComponent {
  entry = input.required<ModelEntry>();

  protected sourceLabel = computed(() =>
    this.entry().source === 'builtin'
      ? 'built into this server'
      : `added to this server${this.entry().installed_at ? ` on ${this.date(this.entry().installed_at!)}` : ''}`,
  );

  protected created = computed(() => {
    const created = this.entry().card?.created_at;
    return created ? this.date(created) : 'Not stated';
  });

  /** Only links a provider URL that is plainly a web address. */
  protected providerUrl = computed(() => {
    const url = this.entry().card?.provider.url ?? '';
    return /^https?:\/\//.test(url) ? url : null;
  });

  protected poorFit = computed(() => (this.entry().card?.metrics.random_forest?.r2 ?? 0) < 0);

  protected hyperparameters = computed(() =>
    Object.entries(this.entry().card?.hyperparameters ?? {})
      .map(([key, value]) => `${key} ${value ?? 'none'}`)
      .join(', '),
  );

  protected framework = computed(() =>
    Object.entries(this.entry().card?.framework ?? {})
      .map(([name, version]) => `${name} ${version}`)
      .join(', '),
  );

  protected featureRows = computed(() => {
    const card = this.entry().card;
    if (!card) return [];
    return card.features.map((key) => ({
      key,
      label: isFeatureColumn(key) ? FEATURE_LABELS[key] : key,
      definition:
        card.feature_definitions[key] ?? (isFeatureColumn(key) ? FEATURE_DEFINITIONS[key] : ''),
      importance:
        card.feature_importances[key] != null ? card.feature_importances[key].toFixed(3) : '-',
    }));
  });

  protected fixed = (value: number | undefined): string => (value == null ? '-' : value.toFixed(2));

  private date(iso: string): string {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime())
      ? iso
      : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }
}
