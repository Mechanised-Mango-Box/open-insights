import { describe, expect, it } from 'vitest';
import { buildAnalysisMethods } from './analysis-methods';
import { DEFAULT_THRESHOLD } from './recommendations';
import { ANALYSIS_FEATURE_COLUMNS, HISTOGRAM_BINS, LOESS_FRAC } from './stats';

describe('buildAnalysisMethods', () => {
  const methods = buildAnalysisMethods({
    rows: [],
    eligibleCount: 12,
    totalCount: 15,
    skipped: [{ reason: 'no screen text', count: 3 }],
  });

  it('reports the records used and why the rest were left out', () => {
    expect(methods.records).toEqual({
      used: 12,
      total: 15,
      skipped: [{ reason: 'no screen text', count: 3 }],
    });
  });

  it('states the constants the computation actually ran with', () => {
    expect(methods.constants.histogram_bins).toBe(HISTOGRAM_BINS);
    expect(methods.constants.loess_frac).toBe(LOESS_FRAC);
    expect(methods.constants.relationship_threshold).toBe(DEFAULT_THRESHOLD);
    const text = methods.techniques.map((t) => t.text).join(' ');
    expect(text).toContain(`${HISTOGRAM_BINS} equal-width bins`);
    expect(text).toContain(`${Math.round(LOESS_FRAC * 100)}%`);
    expect(text).toContain('Pearson');
  });

  it('defines every feature and where it comes from', () => {
    expect(methods.features.map((f) => f.key)).toEqual([...ANALYSIS_FEATURE_COLUMNS]);
    expect(methods.features.find((f) => f.key === 'text_density')?.scans).toEqual([
      'scene stats',
      'screen text',
    ]);
  });
});
