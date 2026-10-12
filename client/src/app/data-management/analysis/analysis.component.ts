import {
  AfterViewInit,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIcon } from '@angular/material/icon';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  ScriptableContext,
  Title,
  Tooltip,
} from 'chart.js';
import {
  ANALYSIS_FEATURE_COLUMNS,
  AnalysisFeatureColumn,
  AnalysisFeatureRow,
  AnalysisResult,
  FEATURE_LABELS,
  computeAnalysis,
} from './stats';
import { RecommendationListComponent, RecommendationRow } from './recommendation-list.component';
import {
  MIN_ROWS_FOR_RECOMMENDATIONS,
  RecommendationOutcome,
  computeRecommendations,
} from './recommendations';
import { AnalysisService } from './analysis.service';
import { AnalysisMethods, buildAnalysisMethods } from './analysis-methods';
import { VideoDatabaseService } from '../video-records/video-database.service';
import { SelectionService } from '../video-records/selection.service';
import { downloadBlob } from '../video-records/manifest-export';
import { ChartImage, buildAnalysisExportZip, snapshotChartToBase64 } from './analysis-export';

// Only the chart types this component actually renders (bar/scatter/line with
// category+linear scales) - chart.js/auto would pull in every controller,
// scale, and plugin the library ships, which blew the initial bundle budget.
Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Title,
  Tooltip,
);

/**
 * The charts are a deliberate light island in an otherwise dark app: a white surface with
 * dark ink, both on the page and in the exported PNGs. Keeping the two identical means a
 * chart reads on screen exactly as it will in whatever report it gets dropped into, and
 * there is no second theme to keep in step.
 *
 * The values are the dataviz palette's light-mode column, validated as a set (CVD
 * separation + contrast) against this white surface.
 */
const CHART_SURFACE = '#ffffff';
const CHART_INK = '#0b0b0b';
const CHART_MUTED_INK = '#52514e';
const CHART_GRID = '#e1e0d9';

const PALETTE = {
  positive: '#2a78d6',
  negative: '#e34948',
  histogram: '#2a78d6',
  scatterPoint: 'rgba(137, 135, 129, 0.7)',
  trend: '#eb6834',
} as const;

type FeatureKey = AnalysisFeatureColumn;

/** ANALYSIS_FEATURE_COLUMNS rather than the label map's key order: the columns
 * are the declared order, and the charts are built by index against them. */
const FEATURE_KEYS: readonly FeatureKey[] = ANALYSIS_FEATURE_COLUMNS;

@Component({
  selector: 'analysis',
  standalone: true,
  imports: [MatButtonModule, MatExpansionModule, MatIcon, RecommendationListComponent],
  template: `
    <div class="view-stack">
      <section class="card actions-column">
        <p class="action-hint">{{ scopeLabel() }}</p>

        <div class="actions">
          <button mat-raised-button color="primary" (click)="runAnalysis()" [disabled]="loading()">
            <mat-icon>play_arrow</mat-icon>
            Run Analysis
          </button>
        </div>

        <div class="actions">
          <button
            mat-stroked-button
            (click)="exportAnalysis()"
            [disabled]="!hasResult() || exporting()"
          >
            <mat-icon>download</mat-icon>
            Export Analysis
          </button>
        </div>

        <!-- At the foot rather than beside Run Analysis: both actions write this, so a
             failed export would otherwise report itself against the wrong button. -->
        @if (statusMessage()) {
          <p class="action-status">{{ statusMessage() }}</p>
        }
      </section>

      @if (!hasResult()) {
        <div class="card">
          <p class="card-lead empty">
            Run the analysis to see correlations and distributions across your records.
          </p>
        </div>
      }

      <div class="results" [hidden]="!hasResult()">
        @if (methods(); as m) {
          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>How these numbers are calculated</mat-panel-title>
              <mat-panel-description>
                {{ m.records.used }} of {{ m.records.total }} records used
              </mat-panel-description>
            </mat-expansion-panel-header>
            <dl class="method-list">
              <dt>Records</dt>
              <dd>
                {{ m.records.used }} of {{ m.records.total }} used. A record needs scene stats, a
                transcript, screen text, audio stats and a YouTube content report.
                @for (s of m.records.skipped; track s.reason) {
                  <br />Left out {{ s.count }}: {{ s.reason }}
                }
              </dd>
              <dt>Engagement</dt>
              <dd>{{ m.target }}</dd>
              @for (t of m.techniques; track t.label) {
                <dt>{{ t.label }}</dt>
                <dd>{{ t.text }}</dd>
              }
            </dl>
            <h3 class="method-heading">Features</h3>
            <table class="method-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>How it is computed</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                @for (f of m.features; track f.key) {
                  <tr>
                    <td>{{ f.label }}</td>
                    <td>{{ f.definition }}</td>
                    <td>{{ f.scans.join(', ') }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <p class="method-note">
              How each Scan result is itself measured, and with which thresholds, is under "How Scan
              calculates its data" on the Scan step. The export includes all of this as
              methods.json.
            </p>
          </mat-expansion-panel>
        }

        <section class="chart-card correlation-card">
          <div class="chart-container correlation-container">
            <canvas #correlationCanvas></canvas>
          </div>
        </section>

        @if (recommendations(); as outcome) {
          <section class="card recommendations-card">
            <h2>What this dataset suggests</h2>
            @if (outcome.ok) {
              <!-- Associations, not advice: the wording comes from the training
                   pipeline, which is careful not to claim a cause. -->
              <p class="card-lead">
                Associations within your own records, not causes - and not predictions about videos
                you have not made yet.
              </p>
              <recommendation-list [rows]="recommendationRows()" />
            } @else if (outcome.reason === 'not-enough-rows') {
              <p class="card-lead">
                Needs at least {{ outcome.rowsNeeded }} eligible records before the relationships
                mean anything - there are {{ featureCount }} features to weigh against each other.
              </p>
            } @else {
              <p class="card-lead">
                These records do not vary independently enough to separate the features apart.
              </p>
            }
          </section>
        }

        @for (key of featureKeys; track key) {
          <section class="feature-section">
            <h2 class="feature-heading">
              {{ featureLabels[key] }}
              @if (correlationLabel(key); as label) {
                <span class="correlation-badge">
                  <span class="dot" [style.background]="correlationColor(key)"></span>
                  {{ label }}
                </span>
              }
            </h2>
            <div class="feature-charts">
              <div class="chart-card">
                <div class="chart-container"><canvas #histCanvas></canvas></div>
              </div>
              <div class="chart-card">
                <div class="chart-container"><canvas #loessCanvas></canvas></div>
              </div>
            </div>
          </section>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .empty {
        margin: 0;
      }
      .results {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
      /* The display above outranks the browser's own [hidden] rule, which left the
         empty charts on screen before the first run. */
      .results[hidden] {
        display: none;
      }
      /* The charts render light-on-white, so their card carries that surface rather than
         the page's dark one. Must stay in step with CHART_SURFACE, which is the ground the
         exported PNG is composited onto - the two are meant to look identical.
         No outline: against the dark page the white already reads as an edge. */
      .chart-card {
        background: #ffffff;
        border-radius: 12px;
        padding: 12px;
      }
      .chart-container {
        position: relative;
        height: 280px;
      }
      .correlation-container {
        height: 220px;
      }
      .feature-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .feature-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        font: var(--mat-sys-title-medium);
        margin: 0;
      }
      .correlation-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font: var(--mat-sys-body-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: none;
      }
      .feature-charts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
        gap: 16px;
      }
    `,
  ],
})
export class AnalysisComponent implements AfterViewInit {
  private dbService = inject(VideoDatabaseService);
  private analysisService = inject(AnalysisService);
  private selectionService = inject(SelectionService);

  /** What the next run will cover, so narrowing the analysis to a selection is
   * visible before pressing the button rather than inferred from the result. */
  protected readonly scopeLabel = computed(() => {
    const selected = this.selectionService.selectedCount();
    return selected > 0
      ? `Analysing ${selected} selected record(s).`
      : 'Analysing every record. Tick rows in the record table on Import, Scan or Export to narrow it.';
  });

  protected readonly featureKeys = FEATURE_KEYS;
  protected readonly featureLabels = FEATURE_LABELS;

  private correlationCanvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('correlationCanvas');
  private histCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('histCanvas');
  private loessCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('loessCanvas');

  loading = signal(false);
  exporting = signal(false);
  statusMessage = signal<string | null>(null);

  private lastResult = signal<AnalysisResult | null>(null);
  private lastRows: AnalysisFeatureRow[] = [];
  protected methods = signal<AnalysisMethods | null>(null);
  protected recommendations = signal<RecommendationOutcome | null>(null);
  protected readonly minRowsForRecommendations = MIN_ROWS_FOR_RECOMMENDATIONS;
  protected readonly featureCount = ANALYSIS_FEATURE_COLUMNS.length;

  /** The features in the order the panel lists them, worst-to-best being no
   * more meaningful than the declared order - so the declared order it is. */
  protected recommendationRows = computed<RecommendationRow[]>(() => {
    const outcome = this.recommendations();
    if (!outcome?.ok) return [];
    return Object.entries(outcome.recommendations.features).map(([key, value]) => ({
      key,
      label: FEATURE_LABELS[key as FeatureKey] ?? key,
      ...value,
    }));
  });
  hasResult = computed(() => this.lastResult() !== null);

  private correlationChart?: Chart;
  private histCharts: Partial<Record<FeatureKey, Chart>> = {};
  private loessCharts: Partial<Record<FeatureKey, Chart>> = {};

  correlationLabel(key: FeatureKey): string | null {
    const value = this.lastResult()?.correlations[key];
    if (value == null) return null;
    return `r = ${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  }

  /** Matches the bar the value has in the correlation chart, tying the two together. */
  correlationColor(key: FeatureKey): string {
    const value = this.lastResult()?.correlations[key] ?? 0;
    return value >= 0 ? PALETTE.positive : PALETTE.negative;
  }

  async runAnalysis(): Promise<void> {
    this.loading.set(true);
    this.statusMessage.set(null);
    try {
      // Selection first, whole library otherwise. Opt-in rather than required:
      // running over everything is the common case, and a stray click in the
      // table should not silently narrow what gets analysed without saying so -
      // which is what the scope line above the button is for.
      const selected = this.selectionService.selection.selected;
      const records = selected.length > 0 ? selected : await this.dbService.getAllVideos();
      const rowResult = this.analysisService.buildFeatureRows(records);
      const { rows, eligibleCount, totalCount } = rowResult;

      if (eligibleCount < 2) {
        const reasons = rowResult.skipped.map((s) => `${s.count} ${s.reason}`).join(', ');
        this.statusMessage.set(
          `Only ${eligibleCount} of ${totalCount} record(s) have scene stats, a transcript, screen text, audio stats and a YouTube content report. Need at least 2 to run analysis.` +
            (reasons ? ` Left out: ${reasons}.` : ''),
        );
        return;
      }

      const result = computeAnalysis(rows);
      this.methods.set(buildAnalysisMethods(rowResult));
      this.renderResult(rows, result);
      this.lastRows = rows;
      this.lastResult.set(result);
      this.recommendations.set(computeRecommendations(rows));
      this.statusMessage.set(`Analysis run on ${eligibleCount} of ${totalCount} record(s).`);
    } catch (error) {
      console.error('Analysis failed:', error);
      this.statusMessage.set('Analysis failed. See console for details.');
    } finally {
      this.loading.set(false);
    }
  }

  async exportAnalysis(): Promise<void> {
    const result = this.lastResult();
    if (!result) return;

    this.exporting.set(true);
    try {
      const images = this.snapshotCharts();
      const outcome = this.recommendations();
      const blob = await buildAnalysisExportZip({
        result,
        rows: this.lastRows,
        featureKeys: FEATURE_KEYS,
        images,
        recommendations: outcome?.ok ? outcome.recommendations : null,
        methods: this.methods(),
      });
      downloadBlob(blob, `open-insights-analysis-${new Date().toISOString()}.zip`);
    } catch (error) {
      console.error('Analysis export failed:', error);
      this.statusMessage.set('Export failed. See console for details.');
    } finally {
      this.exporting.set(false);
    }
  }

  /** The charts already render in the export's colours, so this is a straight snapshot. */
  private snapshotCharts(): ChartImage[] {
    const images: ChartImage[] = [];
    const add = (filename: string, chart: Chart | undefined) => {
      if (chart) {
        images.push({ filename, base64: snapshotChartToBase64(chart, CHART_SURFACE) });
      }
    };

    add('correlation.png', this.correlationChart);
    for (const key of FEATURE_KEYS) {
      add(`${key}-distribution.png`, this.histCharts[key]);
      add(`${key}-engagement.png`, this.loessCharts[key]);
    }
    return images;
  }

  ngAfterViewInit(): void {
    // Read at construction and baked into each chart's resolved options, so these have to
    // be set before the charts below are built.
    Chart.defaults.color = CHART_MUTED_INK;
    Chart.defaults.borderColor = CHART_GRID;

    this.correlationChart = new Chart(this.correlationCanvas().nativeElement, {
      type: 'bar',
      data: {
        labels: FEATURE_KEYS.map((key) => FEATURE_LABELS[key]),
        datasets: [
          {
            label: 'Pearson r with engagement',
            data: [],
            backgroundColor: (ctx: ScriptableContext<'bar'>) =>
              (typeof ctx.raw === 'number' ? ctx.raw : 0) >= 0
                ? PALETTE.positive
                : PALETTE.negative,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { min: -1, max: 1 } },
        plugins: {
          title: {
            display: true,
            text: 'Correlation with Engagement (Pearson r)',
            color: CHART_INK,
          },
          legend: { display: false },
        },
      },
    });

    const histCanvases = this.histCanvases();
    const loessCanvases = this.loessCanvases();

    FEATURE_KEYS.forEach((key, index) => {
      this.histCharts[key] = new Chart(histCanvases[index].nativeElement, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [
            {
              label: `${FEATURE_LABELS[key]} Distribution`,
              data: [],
              backgroundColor: PALETTE.histogram,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: `Distribution of ${FEATURE_LABELS[key]}`,
              color: CHART_INK,
            },
            legend: { display: false },
          },
        },
      });

      this.loessCharts[key] = new Chart(loessCanvases[index].nativeElement, {
        type: 'scatter',
        data: {
          datasets: [
            {
              type: 'scatter',
              label: 'Videos',
              data: [],
              backgroundColor: PALETTE.scatterPoint,
            },
            {
              type: 'line',
              label: 'LOESS Trend',
              data: [],
              pointRadius: 0,
              borderColor: PALETTE.trend,
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            // The legend inherits Chart.defaults.color, which the theme swap sets.
            title: {
              display: true,
              text: `Engagement vs ${FEATURE_LABELS[key]}`,
              color: CHART_INK,
            },
          },
        },
      });
    });
  }

  private renderResult(rows: AnalysisFeatureRow[], result: AnalysisResult): void {
    if (this.correlationChart) {
      const title = this.correlationChart.options.plugins?.title;
      if (title) title.text = `Correlation with Engagement (Pearson r, n = ${rows.length})`;
      this.correlationChart.data.datasets[0].data = FEATURE_KEYS.map(
        (key) => result.correlations[key] ?? 0,
      );
      this.correlationChart.update();
    }

    for (const key of FEATURE_KEYS) {
      const histogram = result.histograms[key];
      const histChart = this.histCharts[key];
      if (histChart && histogram) {
        histChart.data.labels = histogram.bins
          .slice(0, -1)
          .map((edge, i) => `${edge.toFixed(1)}-${histogram.bins[i + 1].toFixed(1)}`);
        histChart.data.datasets[0].data = histogram.counts;
        histChart.update();
      }

      const loess = result.loess[key];
      const loessChart = this.loessCharts[key];
      if (loessChart) {
        loessChart.data.datasets[0].data = rows.map((row) => ({
          x: row[key],
          y: row.average_percentage_viewed,
        }));
        if (loess) {
          loessChart.data.datasets[1].data = loess.x.map((x, i) => ({ x, y: loess.y[i] }));
        }
        loessChart.update();
      }
    }
  }
}
