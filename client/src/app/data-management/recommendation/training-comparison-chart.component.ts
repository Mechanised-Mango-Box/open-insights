import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  BarController,
  BarElement,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  Plugin,
  PointElement,
  Scale,
  ScatterController,
  Tooltip,
  TooltipItem,
} from 'chart.js';
import { CHART_GRID, CHART_INK, CHART_MUTED_INK, PALETTE } from '../analysis/chart-theme';
import { FeatureDistribution } from './recommendation.service';
import { typicalSeries, xRange } from './training-comparison';

Chart.register(
  BarController,
  BarElement,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Tooltip,
);

/** Typical viewing: the training videos' median per bin, with the middle half as a band. */
const TYPICAL = PALETTE.positive;
const TYPICAL_BAND = 'rgba(42, 120, 214, 0.16)';
/** What the model expects for this video, and the video itself on that curve. */
const EXPECTED = PALETTE.trend;
const TRAINING_BARS = PALETTE.scatterPoint;

/** Both charts' y axes take the same width, so their x axes line up and the
 * marker falls through both at the same place. */
const Y_AXIS_WIDTH = 52;
const fixWidth = (scale: Scale): void => {
  scale.width = Y_AXIS_WIDTH;
};

/** A dashed vertical rule at this video's value, through the whole plot. */
const videoMarker = (value: () => number): Plugin => ({
  id: 'videoMarker',
  afterDatasetsDraw(chart) {
    const x = chart.scales['x'].getPixelForValue(value());
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = CHART_INK;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
});

const percent = (value: number): string =>
  `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
const number = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * One feature, the training videos, and this video, as two charts on one x axis:
 *
 *  - above, average percentage viewed: what training videos at each value
 *    typically got (median, and the band their middle half spans), and what the
 *    model expects for this video if only this feature changed, with the video's
 *    own prediction as a point on that curve;
 *  - below, how many training videos sit at each value.
 *
 * Two charts rather than one with a second y axis, because viewing and a count
 * of videos share no scale and a dual axis invites reading one against the other.
 *
 * Rebuilt whole whenever its inputs change: a switch of feature changes the
 * axes, the bins and the series at once, and these are small charts.
 */
@Component({
  selector: 'training-comparison-chart',
  standalone: true,
  template: `
    <div class="chart-card">
      <div class="apv-container"><canvas #apvCanvas></canvas></div>
      <div class="count-container"><canvas #countCanvas></canvas></div>
    </div>
  `,
  styles: [
    `
      /* The same white island as the Analysis charts (CHART_SURFACE). */
      .chart-card {
        background: #ffffff;
        border-radius: 12px;
        padding: 12px;
      }
      .apv-container {
        position: relative;
        height: 260px;
      }
      .count-container {
        position: relative;
        height: 110px;
      }
    `,
  ],
})
export class TrainingComparisonChartComponent {
  label = input.required<string>();
  distribution = input.required<FeatureDistribution>();
  value = input.required<number>();
  prediction = input.required<number>();
  curve = input<{ x: number[]; apv: number[] } | undefined>(undefined);

  private apvCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('apvCanvas');
  private countCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('countCanvas');
  private charts: Chart[] = [];

  constructor() {
    afterRenderEffect(() => this.render());
    inject(DestroyRef).onDestroy(() => this.destroyCharts());
  }

  private destroyCharts(): void {
    for (const chart of this.charts) chart.destroy();
    this.charts = [];
  }

  private render(): void {
    const distribution = this.distribution();
    const value = this.value();
    const prediction = this.prediction();
    const curve = this.curve();
    const label = this.label();
    this.destroyCharts();

    const { histogram } = distribution;
    const range = xRange(histogram, value);
    const pad = (range.max - range.min) * 0.02 || 0.5;
    const x = {
      type: 'linear' as const,
      min: range.min - pad,
      max: range.max + pad,
      grid: { color: CHART_GRID },
      ticks: { color: CHART_MUTED_INK },
    };
    const typical = typicalSeries(distribution);
    const marker = videoMarker(() => value);

    this.charts.push(
      new Chart(this.apvCanvas().nativeElement, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Typical range (middle half)',
              data: typical.p75,
              borderWidth: 0,
              pointRadius: 0,
              backgroundColor: TYPICAL_BAND,
              fill: '+1',
              spanGaps: false,
            },
            {
              label: 'p25',
              data: typical.p25,
              borderWidth: 0,
              pointRadius: 0,
              spanGaps: false,
            },
            {
              label: 'Typical (training median)',
              data: typical.median,
              borderColor: TYPICAL,
              backgroundColor: TYPICAL,
              borderWidth: 2,
              pointRadius: 3,
              spanGaps: false,
            },
            {
              label: 'Expected for this video',
              data: curve ? curve.x.map((cx, i) => ({ x: cx, y: curve.apv[i] })) : [],
              borderColor: EXPECTED,
              backgroundColor: EXPECTED,
              borderWidth: 2,
              borderDash: [6, 4],
              pointRadius: 0,
              pointHitRadius: 6,
            },
            {
              type: 'scatter',
              label: 'This video',
              data: [{ x: value, y: prediction }],
              backgroundColor: EXPECTED,
              borderColor: '#ffffff',
              borderWidth: 2,
              pointRadius: 7,
              pointHoverRadius: 8,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'nearest', intersect: false },
          scales: {
            x: { ...x, ticks: { display: false } },
            y: {
              afterFit: fixWidth,
              grid: { color: CHART_GRID },
              ticks: { color: CHART_MUTED_INK, callback: (v) => `${v}%` },
              title: { display: true, text: 'Average % viewed', color: CHART_MUTED_INK },
            },
          },
          plugins: {
            legend: {
              position: 'top',
              labels: {
                color: CHART_INK,
                usePointStyle: true,
                boxHeight: 8,
                // The band's lower edge is half of one shape, not a series.
                filter: (item) => item.datasetIndex !== 1,
              },
            },
            tooltip: {
              filter: (item) => item.datasetIndex >= 2,
              callbacks: {
                title: (items) =>
                  items.length ? `${label} ${number(items[0].parsed.x ?? 0)}` : '',
                label: (item: TooltipItem<'line'>) => {
                  const y = item.parsed.y ?? 0;
                  if (item.datasetIndex === 2) {
                    const lo = typical.p25[item.dataIndex].y;
                    const hi = typical.p75[item.dataIndex].y;
                    const band =
                      lo != null && hi != null
                        ? ` (middle half ${percent(lo)}-${percent(hi)})`
                        : '';
                    return `Typical: ${percent(y)}${band}`;
                  }
                  if (item.datasetIndex === 3) return `Expected for this video: ${percent(y)}`;
                  return `This video, predicted: ${percent(y)}`;
                },
              },
            },
          },
        },
        plugins: [marker],
      }),
    );

    const centres = histogram.edges
      .slice(0, -1)
      .map((edge, i) => (edge + histogram.edges[i + 1]) / 2);
    this.charts.push(
      new Chart(this.countCanvas().nativeElement, {
        type: 'bar',
        data: {
          datasets: [
            {
              label: 'Training videos',
              data: centres.map((cx, i) => ({ x: cx, y: histogram.counts[i] })),
              backgroundColor: TRAINING_BARS,
              borderRadius: { topLeft: 4, topRight: 4 },
              borderSkipped: 'bottom',
              barPercentage: 0.92,
              categoryPercentage: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales: {
            x: { ...x, title: { display: true, text: label, color: CHART_MUTED_INK } },
            y: {
              afterFit: fixWidth,
              beginAtZero: true,
              grid: { color: CHART_GRID },
              ticks: { color: CHART_MUTED_INK, precision: 0, maxTicksLimit: 3 },
              title: { display: true, text: 'Videos', color: CHART_MUTED_INK },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => {
                  const i = items[0]?.dataIndex ?? 0;
                  return `${label} ${number(histogram.edges[i])}-${number(histogram.edges[i + 1])}`;
                },
                label: (item) => `${item.parsed.y} training videos`,
              },
            },
          },
        },
        plugins: [marker],
      }),
    );
  }
}
