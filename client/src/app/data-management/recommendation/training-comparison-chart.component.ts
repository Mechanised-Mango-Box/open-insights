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
  PointElement,
  Tooltip,
} from 'chart.js';
import { FeatureDistribution } from './recommendation.service';
import { trainingComparisonCharts } from './training-comparison-chart.config';

Chart.register(
  BarController,
  BarElement,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

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

    const configs = trainingComparisonCharts({ label, distribution, value, prediction, curve });
    this.charts.push(
      new Chart(this.apvCanvas().nativeElement, configs.apv),
      new Chart(this.countCanvas().nativeElement, configs.count),
    );
  }
}
