/**
 * A port of the recommendation half of server/model_training/regression.py -
 * standardise the features, fit a multiple linear regression, and read each
 * coefficient as a plain-English statement about the dataset.
 *
 * That Python is the specification, and it stays where it is: classify_feature_
 * relationship and generate_feature_recommendations are followed name for name
 * and string for string, so the wording a user reads here is the wording the
 * training pipeline prints.
 *
 * It runs here rather than behind an endpoint because the server deliberately
 * does not carry sklearn - see the PyInstaller `excludes` in
 * server/open-insights.spec and the note in requirements-training.txt, which
 * record that the request path imports none of the training dependencies. This
 * follows stats.ts, which ports the analysis from the same package.
 */
import { ANALYSIS_FEATURE_COLUMNS, ANALYSIS_TARGET_COLUMN, AnalysisFeatureRow } from './stats';

export type FeatureColumn = (typeof ANALYSIS_FEATURE_COLUMNS)[number];

export type Relationship = 'positive' | 'negative' | 'weak';

export type FeatureRecommendation = {
  coefficient: number;
  relationship: Relationship;
  recommendation: string;
};

export type Recommendations = {
  threshold: number;
  features: Record<string, FeatureRecommendation>;
};

/**
 * The practical-effect threshold from regression.py: less than one percentage
 * point of average_percentage_viewed per standard deviation of the feature is
 * treated as no relationship worth reporting. A project convention, not a
 * statistical test - which is why the number lives here rather than being
 * derived from anything.
 */
export const DEFAULT_THRESHOLD = 1.0;

/**
 * Lower-case because these sit mid-sentence. Kept apart from the component's
 * FEATURE_LABELS, which are title case for headings and carry units the
 * sentences do not want ("Scene Change Rate (per min)").
 */
const FEATURE_DISPLAY_NAMES: Record<string, string> = {
  duration: 'duration',
  wpm: 'speaking speed (WPM)',
  scene_change_rate: 'scene change rate',
  word_count: 'word count',
  speech_pace_variation: 'speech pace variation',
  speaking_ratio: 'speaking ratio',
};

/**
 * Z-scores each column, matching sklearn's StandardScaler.
 *
 * Population standard deviation (ddof=0), which is what StandardScaler uses -
 * deliberately not the sample SD (ddof=1) that calculateSpeechPaceVariation
 * computes for one of the features it is scaling here.
 *
 * A zero-variance column would divide by zero; sklearn substitutes a scale of 1
 * and leaves the centred zeros alone, so the column simply carries no
 * information into the fit rather than poisoning it with NaN.
 */
export function standardise(
  rows: readonly AnalysisFeatureRow[],
  columns: readonly FeatureColumn[],
): number[][] {
  return columns.map((column) => {
    const values = rows.map((row) => row[column]);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const scale = variance > 0 ? Math.sqrt(variance) : 1;
    return values.map((v) => (v - mean) / scale);
  });
}

/**
 * Solves a symmetric linear system by Gaussian elimination with partial
 * pivoting. Small and dense - one row and column per feature - so the textbook
 * method is the right one; stats.ts's solver is hand-rolled for the two
 * parameters of a local linear fit and does not generalise.
 *
 * Returns null when the matrix is singular to working precision, which is what
 * perfectly collinear features produce. The caller reports that rather than
 * handing back coefficients that are an artefact of rounding.
 */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }

  const out = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let col = row + 1; col < n; col++) sum -= a[row][col] * out[col];
    out[row] = sum / a[row][row];
  }
  return out;
}

/**
 * Ordinary least squares over already-standardised columns.
 *
 * Every column has mean zero by construction, so the intercept is exactly
 * mean(y) and drops out of the system - leaving the k x k normal equations
 * X'X b = X'y rather than a (k+1) x (k+1) one. Only the coefficients are
 * returned, since only they carry the relationships.
 */
export function fitStandardisedRegression(
  standardisedColumns: readonly number[][],
  target: readonly number[],
): number[] | null {
  const k = standardisedColumns.length;
  const yMean = target.reduce((sum, v) => sum + v, 0) / target.length;
  const centredY = target.map((v) => v - yMean);

  const xtx = standardisedColumns.map((a) =>
    standardisedColumns.map((b) => a.reduce((sum, v, i) => sum + v * b[i], 0)),
  );
  const xty = standardisedColumns.map((a) => a.reduce((sum, v, i) => sum + v * centredY[i], 0));

  return solve(xtx, xty);
}

/** Port of classify_feature_relationship. Both bounds are inclusive. */
export function classifyFeatureRelationship(
  coefficient: number,
  threshold: number = DEFAULT_THRESHOLD,
): Relationship {
  if (coefficient >= threshold) return 'positive';
  if (coefficient <= -threshold) return 'negative';
  return 'weak';
}

/** Port of generate_feature_recommendations, wording included. */
export function generateFeatureRecommendations(
  coefficients: readonly number[],
  featureNames: readonly string[],
  threshold: number = DEFAULT_THRESHOLD,
): Recommendations {
  const features: Record<string, FeatureRecommendation> = {};

  featureNames.forEach((name, index) => {
    const coefficient = coefficients[index];
    const relationship = classifyFeatureRelationship(coefficient, threshold);
    const label = FEATURE_DISPLAY_NAMES[name] ?? name.replace(/_/g, ' ');

    const recommendation =
      relationship === 'positive'
        ? `In this dataset, higher ${label} is associated with higher average percentage viewed.`
        : relationship === 'negative'
          ? `In this dataset, higher ${label} is associated with lower average percentage viewed.`
          : `In this dataset, ${label} has little to no measurable relationship with average percentage viewed.`;

    features[name] = { coefficient, relationship, recommendation };
  });

  return { threshold, features };
}

/**
 * How many rows before a fit is worth showing. One row per coefficient merely
 * makes the system solvable; the +2 is so the answer is not purely an artefact
 * of having exactly as many unknowns as observations.
 */
export const MIN_ROWS_FOR_RECOMMENDATIONS = ANALYSIS_FEATURE_COLUMNS.length + 2;

export type RecommendationOutcome =
  | { ok: true; recommendations: Recommendations }
  | { ok: false; reason: 'not-enough-rows' | 'collinear'; rowsNeeded: number };

/** The whole path, from analysis rows to the text the panel renders. */
export function computeRecommendations(
  rows: readonly AnalysisFeatureRow[],
  threshold: number = DEFAULT_THRESHOLD,
): RecommendationOutcome {
  if (rows.length < MIN_ROWS_FOR_RECOMMENDATIONS) {
    return { ok: false, reason: 'not-enough-rows', rowsNeeded: MIN_ROWS_FOR_RECOMMENDATIONS };
  }

  const columns = standardise(rows, ANALYSIS_FEATURE_COLUMNS);
  const target = rows.map((row) => row[ANALYSIS_TARGET_COLUMN]);
  const coefficients = fitStandardisedRegression(columns, target);

  if (!coefficients) {
    return { ok: false, reason: 'collinear', rowsNeeded: MIN_ROWS_FOR_RECOMMENDATIONS };
  }

  return {
    ok: true,
    recommendations: generateFeatureRecommendations(
      coefficients,
      ANALYSIS_FEATURE_COLUMNS,
      threshold,
    ),
  };
}
