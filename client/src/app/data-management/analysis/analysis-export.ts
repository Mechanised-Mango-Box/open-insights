import JSZip from 'jszip';
import { Chart } from 'chart.js';
import { AnalysisFeatureRow, AnalysisResult } from '../dataset-server.service';

/** A chart already encoded as base64 PNG, destined for the export's images/ folder. */
export interface ChartImage {
  filename: string;
  base64: string;
}

export interface AnalysisExportInput {
  result: AnalysisResult;
  rows: AnalysisFeatureRow[];
  featureKeys: readonly (keyof AnalysisFeatureRow)[];
  images: ChartImage[];
}

/** Every value here is numeric or a known feature key, so nothing needs quoting. */
const toCsv = (header: string[], rows: (string | number)[][]): string =>
  [header.join(','), ...rows.map((row) => row.join(','))].join('\n');

/**
 * Chart.js renders onto a transparent canvas, so compositing onto a filled one is what
 * keeps the exported PNG readable outside the app. Sized from the canvas's backing store
 * rather than its CSS box, so the snapshot keeps the device pixel ratio it was drawn at.
 *
 * Synchronous by design: the caller restyles the live charts for export, snapshots them,
 * and restyles back, and only an unbroken synchronous run keeps the browser from painting
 * the print colours to the screen in between.
 */
export function snapshotChartToBase64(chart: Chart, background: string): string {
  const source = chart.canvas;
  const composite = document.createElement('canvas');
  composite.width = source.width;
  composite.height = source.height;

  const context = composite.getContext('2d');
  if (!context) return chart.toBase64Image().split(',')[1];

  context.fillStyle = background;
  context.fillRect(0, 0, composite.width, composite.height);
  context.drawImage(source, 0, 0);
  return composite.toDataURL('image/png').split(',')[1];
}

/**
 * Bundles the current analysis as a zip: images/ holds a PNG per chart, figures/ holds the
 * numbers behind them as CSVs, so a figure can be re-plotted or checked outside the app.
 */
export async function buildAnalysisExportZip({
  result,
  rows,
  featureKeys,
  images,
}: AnalysisExportInput): Promise<Blob> {
  const zip = new JSZip();

  for (const { filename, base64 } of images) {
    zip.file(`images/${filename}`, base64, { base64: true });
  }

  zip.file(
    'figures/correlations.csv',
    toCsv(
      ['feature', 'correlation'],
      featureKeys.map((key) => [key, result.correlations[key] ?? 0]),
    ),
  );

  for (const key of featureKeys) {
    const histogram = result.histograms[key];
    if (histogram) {
      zip.file(
        `figures/${key}-histogram.csv`,
        toCsv(
          ['bin_start', 'bin_end', 'count'],
          histogram.counts.map((count, i) => [histogram.bins[i], histogram.bins[i + 1], count]),
        ),
      );
    }

    zip.file(
      `figures/${key}-scatter.csv`,
      toCsv(
        [key, 'average_percentage_viewed'],
        rows.map((row) => [row[key], row.average_percentage_viewed]),
      ),
    );

    const loess = result.loess[key];
    if (loess) {
      zip.file(
        `figures/${key}-loess.csv`,
        toCsv(
          [key, 'fitted_percentage_viewed'],
          loess.x.map((x, i) => [x, loess.y[i]]),
        ),
      );
    }
  }

  return zip.generateAsync({ type: 'blob' });
}
