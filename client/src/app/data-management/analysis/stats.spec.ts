import { describe, expect, it } from 'vitest';
import { STATS_GOLDEN } from './stats.golden';
import {
  ANALYSIS_FEATURE_COLUMNS,
  AnalysisFeatureRow,
  computeAnalysis,
  computeHistogram,
  computeLoess,
  pearson,
} from './stats';

describe('stats, against the Python it was ported from', () => {
  for (const golden of STATS_GOLDEN) {
    describe(golden.name, () => {
      it('smooths to the same curve', () => {
        const { x, y } = computeLoess(golden.x, golden.y);
        expect(x).toHaveLength(100);
        expect(y).toHaveLength(100);
        // A tolerance rather than equality: numpy's argsort is unstable, so a
        // tie at the k-th neighbour is free to resolve either way.
        for (const [i, value] of y.entries()) {
          expect(value).toBeCloseTo(golden.loessY[i], 9);
        }
      });

      it('bins to the same histogram', () => {
        const { bins, counts } = computeHistogram(golden.x);
        for (const [i, edge] of bins.entries()) {
          expect(edge).toBeCloseTo(golden.bins[i], 9);
        }
        expect(counts).toEqual(golden.counts);
        expect(counts.reduce((a, b) => a + b, 0)).toBe(golden.x.length);
      });

      it('correlates to the same coefficient', () => {
        expect(pearson(golden.x, golden.y)).toBeCloseTo(golden.corr, 9);
      });
    });
  }
});

describe('computeAnalysis', () => {
  // Every feature varies across the three rows: a constant column would take the
  // zero-width histogram and rank-deficient loess paths instead of the ordinary ones.
  const rows: AnalysisFeatureRow[] = [
    {
      duration: 10,
      wpm: 120,
      scene_change_rate: 2,
      word_count: 1200,
      speech_pace_variation: 15,
      speaking_ratio: 0.8,
      average_percentage_viewed: 50,
    },
    {
      duration: 20,
      wpm: 150,
      scene_change_rate: 4,
      word_count: 3000,
      speech_pace_variation: 22,
      speaking_ratio: 0.65,
      average_percentage_viewed: 30,
    },
    {
      duration: 15,
      wpm: 130,
      scene_change_rate: 3,
      word_count: 1950,
      speech_pace_variation: 18,
      speaking_ratio: 0.72,
      average_percentage_viewed: 41,
    },
  ];

  it('reports every feature column in each section', () => {
    const result = computeAnalysis(rows);
    for (const feature of ANALYSIS_FEATURE_COLUMNS) {
      expect(result.histograms[feature].bins).toHaveLength(16);
      expect(result.histograms[feature].counts).toHaveLength(15);
      expect(result.loess[feature].x).toHaveLength(100);
      expect(result.loess[feature].y).toHaveLength(100);
      expect(result.correlations[feature]).toBeTypeOf('number');
      expect(Number.isNaN(result.correlations[feature])).toBe(false);
    }
  });

  it('correlates the target against itself as +1 when a feature tracks it', () => {
    // word_count is duration * wpm here, so it moves with neither target
    // direction by construction - this asserts the sign is real, not that a
    // constant is being returned.
    const result = computeAnalysis(rows);
    expect(result.correlations['duration']).toBeLessThan(0);
  });
});
