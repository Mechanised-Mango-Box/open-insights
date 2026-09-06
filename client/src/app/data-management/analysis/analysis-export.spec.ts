import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { AnalysisFeatureRow, AnalysisResult } from '../dataset-server.service';
import { buildAnalysisExportZip } from './analysis-export';

const rows: AnalysisFeatureRow[] = [
  { duration_mins: 10, wpm: 120, scene_change_rate: 2, word_count: 1200, average_percentage_viewed: 50 },
  { duration_mins: 20, wpm: 150, scene_change_rate: 4, word_count: 3000, average_percentage_viewed: 30 },
];

const result: AnalysisResult = {
  correlations: { duration_mins: -0.8 },
  histograms: { duration_mins: { bins: [0, 10, 20], counts: [1, 1] } },
  loess: { duration_mins: { x: [10, 20], y: [50, 30] } },
};

/** Images are supplied pre-encoded by the caller, so these cover the figures/ side. */
const buildZip = () =>
  buildAnalysisExportZip({
    result,
    rows,
    featureKeys: ['duration_mins'],
    images: [],
  });

const readCsv = async (zip: JSZip, path: string) => {
  const file = zip.file(path);
  expect(file, `expected ${path} in the zip`).not.toBeNull();
  return (await file!.async('string')).split('\n');
};

describe('buildAnalysisExportZip figures', () => {
  it('writes one histogram row per count, pairing each with its bin edges', async () => {
    const zip = await JSZip.loadAsync(await buildZip());

    expect(await readCsv(zip, 'figures/duration_mins-histogram.csv')).toEqual([
      'bin_start,bin_end,count',
      '0,10,1',
      '10,20,1',
    ]);
  });

  it('writes correlations, scatter points and the loess curve', async () => {
    const zip = await JSZip.loadAsync(await buildZip());

    expect(await readCsv(zip, 'figures/correlations.csv')).toEqual([
      'feature,correlation',
      'duration_mins,-0.8',
    ]);
    expect(await readCsv(zip, 'figures/duration_mins-scatter.csv')).toEqual([
      'duration_mins,average_percentage_viewed',
      '10,50',
      '20,30',
    ]);
    expect(await readCsv(zip, 'figures/duration_mins-loess.csv')).toEqual([
      'duration_mins,fitted_percentage_viewed',
      '10,50',
      '20,30',
    ]);
  });

  it('files supplied images under images/', async () => {
    const blob = await buildAnalysisExportZip({
      result,
      rows,
      featureKeys: ['duration_mins'],
      // A 1x1 PNG - enough to prove the base64 lands as binary under the right path.
      images: [
        {
          filename: 'correlation.png',
          base64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        },
      ],
    });
    const zip = await JSZip.loadAsync(blob);

    const png = zip.file('images/correlation.png');
    expect(png).not.toBeNull();
    // PNG magic number - confirms it was decoded from base64, not stored as text.
    expect(Array.from((await png!.async('uint8array')).slice(0, 4))).toEqual([137, 80, 78, 71]);
  });

  it('defaults a missing correlation to zero rather than writing undefined', async () => {
    const blob = await buildAnalysisExportZip({
      result: { correlations: {}, histograms: {}, loess: {} },
      rows,
      featureKeys: ['wpm'],
      images: [],
    });
    const zip = await JSZip.loadAsync(blob);

    expect(await readCsv(zip, 'figures/correlations.csv')).toEqual(['feature,correlation', 'wpm,0']);
  });
});
