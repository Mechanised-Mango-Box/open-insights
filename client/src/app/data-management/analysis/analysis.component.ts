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
import { AnalysisFeatureRow, AnalysisResult } from '../dataset-server.service';
import { AnalysisService } from './analysis.service';
import { VideoDatabaseService } from '../video-records/video-database.service';
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

type FeatureKey = 'duration_mins' | 'wpm' | 'scene_change_rate' | 'word_count';

const FEATURE_LABELS: Record<FeatureKey, string> = {
  duration_mins: 'Duration (minutes)',
  wpm: 'Speaking Speed (WPM)',
  scene_change_rate: 'Scene Change Rate (per min)',
  word_count: 'Word Count',
};

const FEATURE_KEYS = Object.keys(FEATURE_LABELS) as FeatureKey[];

@Component({
  selector: 'analysis',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    <div class="analysis-page">
      <div class="toolbar">
        <button mat-raised-button color="primary" (click)="runAnalysis()" [disabled]="loading()">
          Run Analysis
        </button>
        <button
          mat-raised-button
          (click)="exportAnalysis()"
          [disabled]="!hasResult() || exporting()"
        >
          Export Analysis
        </button>
        @if (statusMessage()) {
          <p class="status">{{ statusMessage() }}</p>
        }
      </div>

      @if (!hasResult()) {
        <div class="empty-state">
          <p>Run the analysis to see correlations and distributions across the dataset.</p>
        </div>
      }

      <div class="results" [hidden]="!hasResult()">
        <section class="chart-card correlation-card">
          <div class="chart-container correlation-container">
            <canvas #correlationCanvas></canvas>
          </div>
        </section>

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
      .analysis-page {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
      .toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 16px;
      }
      .status {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
      }
      .empty-state {
        background: var(--mat-sys-surface-container);
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 12px;
        padding: 24px;
      }
      .empty-state p {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
      }
      .results {
        display: flex;
        flex-direction: column;
        gap: 24px;
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
        grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
        gap: 16px;
      }
    `,
  ],
})
export class AnalysisComponent implements AfterViewInit {
  private dbService = inject(VideoDatabaseService);
  private analysisService = inject(AnalysisService);

  protected readonly featureKeys = FEATURE_KEYS;
  protected readonly featureLabels = FEATURE_LABELS;

  private correlationCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('correlationCanvas');
  private histCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('histCanvas');
  private loessCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('loessCanvas');

  loading = signal(false);
  exporting = signal(false);
  statusMessage = signal<string | null>(null);

  private lastResult = signal<AnalysisResult | null>(null);
  private lastRows: AnalysisFeatureRow[] = [];
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
      const records = await this.dbService.getAllVideos();
      const { rows, eligibleCount, totalCount } = this.analysisService.buildFeatureRows(records);

      if (eligibleCount < 2) {
        this.statusMessage.set(
          `Only ${eligibleCount} of ${totalCount} record(s) have transcript + scene stats + YouTube content data. Need at least 2 to run analysis.`,
        );
        return;
      }

      const result = await this.analysisService.runAnalysis(rows);
      this.renderResult(rows, result);
      this.lastRows = rows;
      this.lastResult.set(result);
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
      const blob = await buildAnalysisExportZip({
        result,
        rows: this.lastRows,
        featureKeys: FEATURE_KEYS,
        images,
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
            label: 'Correlation with Engagement',
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
          title: { display: true, text: 'Correlation with Engagement', color: CHART_INK },
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
            title: { display: true, text: `Distribution of ${FEATURE_LABELS[key]}`, color: CHART_INK },
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
            title: { display: true, text: `Engagement vs ${FEATURE_LABELS[key]}`, color: CHART_INK },
          },
        },
      });
    });
  }

  private renderResult(rows: AnalysisFeatureRow[], result: AnalysisResult): void {
    if (this.correlationChart) {
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
