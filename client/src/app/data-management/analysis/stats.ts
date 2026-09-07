/**
 * Ported from server/analysis.py (itself a pure-numpy port of
 * model_training/data_analysis.py). The Python remains the specification: the
 * golden values in stats.spec.ts were produced by running it, so a change here
 * that moves a number needs a matching check against that module.
 *
 * Where numpy semantics are load-bearing rather than incidental - the zero-width
 * histogram range, the rank-deficient least-squares fallback - the reason is
 * noted inline, because the plain-arithmetic version silently disagrees.
 */

export type AnalysisFeatureRow = {
  duration_mins: number;
  wpm: number;
  scene_change_rate: number;
  word_count: number;
  average_percentage_viewed: number;
};

export type AnalysisResult = {
  histograms: Record<string, { bins: number[]; counts: number[] }>;
  correlations: Record<string, number>;
  loess: Record<string, { x: number[]; y: number[] }>;
};

export const ANALYSIS_FEATURE_COLUMNS = [
  'duration_mins',
  'wpm',
  'scene_change_rate',
  'word_count',
] as const satisfies readonly (keyof AnalysisFeatureRow)[];

export const ANALYSIS_TARGET_COLUMN =
  'average_percentage_viewed' satisfies keyof AnalysisFeatureRow;

/** np.linspace: `num` points from start to stop inclusive. The endpoint is
 * assigned rather than accumulated, as numpy does, so it lands exactly on
 * `stop` instead of a step's worth of rounding away from it. */
const linspace = (start: number, stop: number, num: number): number[] => {
  if (num === 1) return [start];
  const step = (stop - start) / (num - 1);
  const out = new Array<number>(num);
  for (let i = 0; i < num; i++) out[i] = start + i * step;
  out[num - 1] = stop;
  return out;
};

/**
 * Tricube-weighted local linear regression, evaluated at `nPoints` evenly
 * spaced x. Mirrors compute_loess() in server/analysis.py.
 *
 * Note both sorts are stable here and quicksort in numpy, so tied x values (or
 * tied distances at the k-th neighbour) can select a different neighbour set.
 * With frac=0.66 over continuous features that does not arise in practice, but
 * it is why the tests compare within a tolerance rather than exactly.
 */
export function computeLoess(
  xIn: readonly number[],
  yIn: readonly number[],
  frac = 0.66,
  nPoints = 100,
): { x: number[]; y: number[] } {
  const order = xIn.map((_, i) => i).sort((a, b) => xIn[a] - xIn[b]);
  const x = order.map((i) => xIn[i]);
  const y = order.map((i) => yIn[i]);

  const n = x.length;
  const k = Math.max(2, Math.ceil(frac * n));

  const xEval = linspace(x[0], x[n - 1], nPoints);
  const yEval = new Array<number>(nPoints);

  const indices = x.map((_, i) => i);

  for (let i = 0; i < nPoints; i++) {
    const x0 = xEval[i];
    const nearest = indices
      .slice()
      .sort((a, b) => Math.abs(x[a] - x0) - Math.abs(x[b] - x0))
      .slice(0, k);
    const maxDist = Math.abs(x[nearest[nearest.length - 1]] - x0);

    let sW = 0;
    let sX = 0;
    let sY = 0;
    let sXX = 0;
    let sXY = 0;

    for (const j of nearest) {
      const d = x[j] - x0;
      const w = maxDist === 0 ? 1 : (1 - Math.abs(d / maxDist) ** 3) ** 3;
      sW += w;
      sX += w * d;
      sY += w * y[j];
      sXX += w * d * d;
      sXY += w * d * y[j];
    }

    // Normal equations for the weighted fit of y ~ 1 + (x - x0); the intercept
    // is the smoothed value, since the design is centred on x0.
    const denom = sW * sXX - sX * sX;

    if (Math.abs(denom) > 1e-12 * (sW * sXX)) {
      yEval[i] = (sXX * sY - sX * sXY) / denom;
      continue;
    }

    // Every neighbour sits at the same distance from x0, so the two columns are
    // collinear and the fit is rank-deficient. np.linalg.lstsq answers with the
    // minimum-norm solution, which splits the weighted mean across both
    // coefficients as t/(1+c^2) - not the weighted mean itself. The common case
    // is c=0 (the neighbours are all *at* x0), where the two agree.
    const c = sW === 0 ? 0 : sX / sW;
    yEval[i] = sW === 0 ? 0 : sY / sW / (1 + c * c);
  }

  return { x: xEval, y: yEval };
}

/** np.histogram(values, bins) - returns the bin edges and the counts. */
export function computeHistogram(
  values: readonly number[],
  bins = 15,
): { bins: number[]; counts: number[] } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }

  // A constant column has no width to bin. numpy pads it to [v-0.5, v+0.5]
  // rather than dividing by zero, and the edges it reports say so.
  if (lo === hi) {
    lo -= 0.5;
    hi += 0.5;
  }

  const edges = linspace(lo, hi, bins + 1);
  const counts = new Array<number>(bins).fill(0);
  const norm = bins / (hi - lo);

  for (const v of values) {
    let i = Math.floor((v - lo) * norm);
    // The right edge belongs to the last bin, which the scaling alone puts one
    // past the end.
    if (i >= bins) i = bins - 1;
    // numpy recomputes the estimate against the real edges, because a value
    // sitting on a boundary can scale to either side of it.
    if (i > 0 && v < edges[i]) i -= 1;
    else if (i < bins - 1 && v >= edges[i + 1]) i += 1;
    counts[i] += 1;
  }

  return { bins: edges, counts };
}

/** Pearson correlation. A constant column has zero variance, which pandas
 * reports as NaN and routes.py substituted with 0 before serialising - so the
 * substitution happens here instead. */
export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const u = a[i] - meanA;
    const v = b[i] - meanB;
    cov += u * v;
    varA += u * u;
    varB += v * v;
  }

  const den = Math.sqrt(varA * varB);
  return den === 0 ? 0 : cov / den;
}

/** The whole of what POST /api/analysis used to return, computed locally. */
export function computeAnalysis(rows: readonly AnalysisFeatureRow[]): AnalysisResult {
  const target = rows.map((row) => row[ANALYSIS_TARGET_COLUMN]);

  const histograms: AnalysisResult['histograms'] = {};
  const correlations: AnalysisResult['correlations'] = {};
  const loess: AnalysisResult['loess'] = {};

  for (const feature of ANALYSIS_FEATURE_COLUMNS) {
    const values = rows.map((row) => row[feature]);
    histograms[feature] = computeHistogram(values);
    correlations[feature] = pearson(values, target);
    loess[feature] = computeLoess(values, target);
  }

  return { histograms, correlations, loess };
}
