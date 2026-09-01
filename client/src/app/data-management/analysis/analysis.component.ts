import { AfterViewInit, Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import Chart from 'chart.js/auto';
import { AnalysisFeatureRow, AnalysisResult } from '../dataset-server.service';
import { AnalysisService } from './analysis.service';
import { VideoDatabaseService } from '../video-records/video-database.service';

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
      <button mat-raised-button color="primary" (click)="runAnalysis()" [disabled]="loading()">
        Run Analysis
      </button>
      @if (statusMessage()) {
      <p>{{ statusMessage() }}</p>
      }

      <div class="chart-row">
        <div class="chart-container"><canvas #correlationCanvas></canvas></div>
      </div>
      <div class="chart-row">
        <div class="chart-container"><canvas #durationHistCanvas></canvas></div>
        <div class="chart-container"><canvas #durationLoessCanvas></canvas></div>
      </div>
      <div class="chart-row">
        <div class="chart-container"><canvas #wpmHistCanvas></canvas></div>
        <div class="chart-container"><canvas #wpmLoessCanvas></canvas></div>
      </div>
      <div class="chart-row">
        <div class="chart-container"><canvas #sceneRateHistCanvas></canvas></div>
        <div class="chart-container"><canvas #sceneRateLoessCanvas></canvas></div>
      </div>
      <div class="chart-row">
        <div class="chart-container"><canvas #wordCountHistCanvas></canvas></div>
        <div class="chart-container"><canvas #wordCountLoessCanvas></canvas></div>
      </div>
    </div>
  `,
  styles: [
    `
      .chart-row {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }
      .chart-container {
        position: relative;
        width: 420px;
        height: 280px;
      }
    `,
  ],
})
export class AnalysisComponent implements AfterViewInit {
  private dbService = inject(VideoDatabaseService);
  private analysisService = inject(AnalysisService);

  @ViewChild('correlationCanvas') correlationCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('durationHistCanvas') durationHistCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('durationLoessCanvas') durationLoessCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('wpmHistCanvas') wpmHistCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('wpmLoessCanvas') wpmLoessCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('sceneRateHistCanvas') sceneRateHistCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('sceneRateLoessCanvas') sceneRateLoessCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('wordCountHistCanvas') wordCountHistCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('wordCountLoessCanvas') wordCountLoessCanvasRef!: ElementRef<HTMLCanvasElement>;

  loading = signal(false);
  statusMessage = signal<string | null>(null);

  private correlationChart?: Chart;
  private histCharts: Partial<Record<FeatureKey, Chart>> = {};
  private loessCharts: Partial<Record<FeatureKey, Chart>> = {};

  ngAfterViewInit(): void {
    this.correlationChart = new Chart(this.correlationCanvasRef.nativeElement, {
      type: 'bar',
      data: {
        labels: FEATURE_KEYS.map((key) => FEATURE_LABELS[key]),
        datasets: [{ label: 'Correlation with Engagement', data: [], backgroundColor: '#1f24d1' }],
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false },
    });

    const histRefs: Record<FeatureKey, ElementRef<HTMLCanvasElement>> = {
      duration_mins: this.durationHistCanvasRef,
      wpm: this.wpmHistCanvasRef,
      scene_change_rate: this.sceneRateHistCanvasRef,
      word_count: this.wordCountHistCanvasRef,
    };
    const loessRefs: Record<FeatureKey, ElementRef<HTMLCanvasElement>> = {
      duration_mins: this.durationLoessCanvasRef,
      wpm: this.wpmLoessCanvasRef,
      scene_change_rate: this.sceneRateLoessCanvasRef,
      word_count: this.wordCountLoessCanvasRef,
    };

    for (const key of FEATURE_KEYS) {
      this.histCharts[key] = new Chart(histRefs[key].nativeElement, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [
            { label: `${FEATURE_LABELS[key]} Distribution`, data: [], backgroundColor: '#3498db' },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: `Distribution of ${FEATURE_LABELS[key]}` } },
        },
      });

      this.loessCharts[key] = new Chart(loessRefs[key].nativeElement, {
        type: 'scatter',
        data: {
          datasets: [
            { type: 'scatter', label: 'Videos', data: [], backgroundColor: '#7f8c8d' },
            {
              type: 'line',
              label: 'LOESS Trend',
              data: [],
              pointRadius: 0,
              borderColor: '#e74c3c',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: `Engagement vs ${FEATURE_LABELS[key]}` } },
        },
      });
    }
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
      this.statusMessage.set(`Analysis run on ${eligibleCount} of ${totalCount} record(s).`);
    } catch (error) {
      console.error('Analysis failed:', error);
      this.statusMessage.set('Analysis failed. See console for details.');
    } finally {
      this.loading.set(false);
    }
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
