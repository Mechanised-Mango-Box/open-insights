import { describe, expect, it } from 'vitest';
import { ANALYSIS_FEATURE_COLUMNS, AnalysisFeatureRow } from './stats';
import {
  RECOMMENDATIONS_GOLDEN_COEFFICIENTS,
  RECOMMENDATIONS_GOLDEN_INTERCEPT,
  RECOMMENDATIONS_GOLDEN_ROWS,
} from './recommendations.golden';
import {
  MIN_ROWS_FOR_RECOMMENDATIONS,
  classifyFeatureRelationship,
  computeRecommendations,
  fitStandardisedRegression,
  generateFeatureRecommendations,
  standardise,
} from './recommendations';

/**
 * The first two blocks are ports of test_recommendation.py, case for case. That
 * file stubs model.coef_ with fixed values rather than fitting anything, so the
 * classification boundaries and the exact wording transfer without needing
 * Python or sklearn to run.
 */
describe('classifyFeatureRelationship, against test_recommendation.py', () => {
  it('1. classifies a clearly positive coefficient', () => {
    expect(classifyFeatureRelationship(2.5)).toBe('positive');
  });

  it('2. classifies a clearly negative coefficient', () => {
    expect(classifyFeatureRelationship(-3.0)).toBe('negative');
  });

  it('3. treats zero as weak', () => {
    expect(classifyFeatureRelationship(0.0)).toBe('weak');
  });

  it('4. treats just below +1.0 as weak', () => {
    expect(classifyFeatureRelationship(0.99)).toBe('weak');
  });

  it('5. treats just above -1.0 as weak', () => {
    expect(classifyFeatureRelationship(-0.99)).toBe('weak');
  });

  // The boundary is inclusive on both sides, which is the easiest thing to get
  // wrong when porting a chain of if/elif.
  it('6. treats exactly +1.0 as positive', () => {
    expect(classifyFeatureRelationship(1.0)).toBe('positive');
  });

  it('7. treats exactly -1.0 as negative', () => {
    expect(classifyFeatureRelationship(-1.0)).toBe('negative');
  });
});

describe('generateFeatureRecommendations wording and structure', () => {
  const FEATURE_NAMES = [
    'duration',
    'wpm',
    'scene_change_rate',
    'word_count',
    'speech_pace_variation',
    'speaking_ratio',
  ];
  const COEFFICIENTS = [2.5, -3.0, 0.5, -0.99, 1.2, -0.5];

  const recs = generateFeatureRecommendations(COEFFICIENTS, FEATURE_NAMES, 1.0);

  it('reports the threshold it used, and one entry per feature', () => {
    expect(recs.threshold).toBe(1.0);
    expect(Object.keys(recs.features)).toHaveLength(6);
  });

  it('words a positive relationship', () => {
    expect(recs.features['duration'].relationship).toBe('positive');
    expect(recs.features['duration'].recommendation).toBe(
      'In this dataset, higher duration is associated with higher average percentage viewed.',
    );
  });

  it('words a negative relationship, using the display name', () => {
    expect(recs.features['wpm'].relationship).toBe('negative');
    expect(recs.features['wpm'].recommendation).toBe(
      'In this dataset, higher speaking speed (WPM) is associated with lower average percentage viewed.',
    );
  });

  it('words a weak relationship', () => {
    expect(recs.features['scene_change_rate'].relationship).toBe('weak');
    expect(recs.features['scene_change_rate'].recommendation).toBe(
      'In this dataset, scene change rate has little to no measurable relationship with average percentage viewed.',
    );
    expect(recs.features['word_count'].relationship).toBe('weak');
    expect(recs.features['word_count'].recommendation).toBe(
      'In this dataset, word count has little to no measurable relationship with average percentage viewed.',
    );
  });

  it('words the two speech features', () => {
    expect(recs.features['speech_pace_variation'].relationship).toBe('positive');
    expect(recs.features['speech_pace_variation'].recommendation).toBe(
      'In this dataset, higher speech pace variation is associated with higher average percentage viewed.',
    );
    expect(recs.features['speaking_ratio'].relationship).toBe('weak');
    expect(recs.features['speaking_ratio'].recommendation).toBe(
      'In this dataset, speaking ratio has little to no measurable relationship with average percentage viewed.',
    );
  });

  it('carries the coefficient through unchanged', () => {
    expect(recs.features['duration'].coefficient).toBe(2.5);
    expect(recs.features['speaking_ratio'].coefficient).toBe(-0.5);
  });
});

describe('standardise', () => {
  const rows = [{ a: 2 }, { a: 4 }, { a: 4 }, { a: 4 }, { a: 5 }, { a: 5 }, { a: 7 }, { a: 9 }];

  it('z-scores with the population SD, as StandardScaler does', () => {
    // mean 5, population SD 2 - the sample SD would be ~2.138 and shift every
    // value, so this is what separates the two conventions.
    const [column] = standardise(rows as never, ['a'] as never);
    expect(column).toEqual([-1.5, -0.5, -0.5, -0.5, 0, 0, 1, 2]);
  });

  it('leaves a zero-variance column as zeros rather than NaN', () => {
    const [column] = standardise([{ a: 3 }, { a: 3 }] as never, ['a'] as never);
    expect(column).toEqual([0, 0]);
  });
});

describe('fitStandardisedRegression', () => {
  it('recovers the coefficients of an exactly linear target', () => {
    // Two independent standardised columns and y = 3*x1 - 2*x2 + 10. With the
    // columns orthogonal, each coefficient is recoverable in closed form.
    const x1 = [-1, -1, 1, 1];
    const x2 = [-1, 1, -1, 1];
    const y = x1.map((v, i) => 3 * v - 2 * x2[i] + 10);

    const coefficients = fitStandardisedRegression([x1, x2], y);

    expect(coefficients).not.toBeNull();
    expect(coefficients![0]).toBeCloseTo(3, 9);
    expect(coefficients![1]).toBeCloseTo(-2, 9);
  });

  it('returns null for perfectly collinear columns rather than rounding noise', () => {
    const x1 = [-1, 0, 1];
    const duplicate = [-1, 0, 1];
    const y = [1, 2, 3];

    expect(fitStandardisedRegression([x1, duplicate], y)).toBeNull();
  });
});

describe('computeRecommendations', () => {
  const row = (overrides: Partial<AnalysisFeatureRow>): AnalysisFeatureRow => ({
    duration: 10,
    wpm: 120,
    scene_change_rate: 2,
    word_count: 1200,
    speech_pace_variation: 15,
    speaking_ratio: 0.8,
    average_percentage_viewed: 50,
    ...overrides,
  });

  it('refuses to fit fewer rows than it has coefficients to report', () => {
    const rows = Array.from({ length: MIN_ROWS_FOR_RECOMMENDATIONS - 1 }, (_, i) =>
      row({ duration: 10 + i }),
    );

    const outcome = computeRecommendations(rows);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('not-enough-rows');
  });

  it('reports one recommendation per feature once there are enough rows', () => {
    // Every feature varies independently, so the design is not collinear.
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({
        duration: 10 + i,
        wpm: 120 + ((i * 7) % 13),
        scene_change_rate: 2 + ((i * 3) % 5),
        word_count: 1200 + ((i * 11) % 17) * 30,
        speech_pace_variation: 15 + ((i * 5) % 9),
        speaking_ratio: 0.5 + (i % 5) * 0.1,
        average_percentage_viewed: 50 - i * 2,
      }),
    );

    const outcome = computeRecommendations(rows);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Object.keys(outcome.recommendations.features)).toHaveLength(6);
    for (const feature of Object.values(outcome.recommendations.features)) {
      expect(Number.isFinite(feature.coefficient)).toBe(true);
      expect(feature.recommendation).toContain('In this dataset,');
    }
  });
});

describe('the fit, against the sklearn it was ported from', () => {
  const columns = standardise(RECOMMENDATIONS_GOLDEN_ROWS, ANALYSIS_FEATURE_COLUMNS);
  const target = RECOMMENDATIONS_GOLDEN_ROWS.map((row) => row.average_percentage_viewed);

  it('reproduces StandardScaler: population SD, mean zero', () => {
    for (const column of columns) {
      const mean = column.reduce((sum, v) => sum + v, 0) / column.length;
      const sd = Math.sqrt(column.reduce((sum, v) => sum + (v - mean) ** 2, 0) / column.length);
      expect(mean).toBeCloseTo(0, 9);
      expect(sd).toBeCloseTo(1, 9);
    }
  });

  it('reproduces LinearRegression.coef_ on the same data', () => {
    const coefficients = fitStandardisedRegression(columns, target);
    expect(coefficients).not.toBeNull();

    // A tolerance rather than equality, and not for rounding trivia: this solves
    // the normal equations (X'X b = X'y), which squares the condition number of
    // X, while sklearn does an SVD-based least-squares solve. On standardised,
    // well-conditioned columns the two agree far inside this bound - a failure
    // here means the solver needs to become QR/SVD, not that the bound needs
    // widening.
    ANALYSIS_FEATURE_COLUMNS.forEach((name, i) => {
      expect(coefficients![i]).toBeCloseTo(RECOMMENDATIONS_GOLDEN_COEFFICIENTS[name], 6);
    });
  });

  it('recovers the intercept as mean(y), which is what standardising buys', () => {
    const mean = target.reduce((sum, v) => sum + v, 0) / target.length;
    expect(mean).toBeCloseTo(RECOMMENDATIONS_GOLDEN_INTERCEPT, 6);
  });

  it('classifies the golden coefficients the way the Python reports them', () => {
    const coefficients = fitStandardisedRegression(columns, target)!;
    const recs = generateFeatureRecommendations(coefficients, ANALYSIS_FEATURE_COLUMNS);

    // Straight from the golden values: |coef| >= 1 either way, under it weak.
    expect(recs.features['word_count'].relationship).toBe('negative');
    expect(recs.features['scene_change_rate'].relationship).toBe('positive');
    expect(recs.features['duration'].relationship).toBe('weak');
  });
});
