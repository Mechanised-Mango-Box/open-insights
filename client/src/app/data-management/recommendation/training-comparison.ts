import { FeatureDistribution, TrainingHistogram } from './recommendation.service';

/**
 * The arithmetic behind placing one video against a model's training videos -
 * the strip beside each feature and the chart beneath them - kept apart from
 * the components so it can be tested without rendering anything.
 */

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st. */
export const ordinal = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

/**
 * "higher than 82% of the 114 training videos", from the side of the middle the
 * value is on, so the number is always the larger, easier-read share.
 */
export const percentileSentence = (percentile: number, rows: number): string => {
  const videos = `the ${rows} training videos`;
  if (percentile >= 100) return `at or above the highest of ${videos}`;
  if (percentile <= 0) return `at or below the lowest of ${videos}`;
  // Kept off 0 and 100, which the lines above say in words.
  const rounded = Math.min(99, Math.max(1, Math.round(percentile)));
  return rounded >= 50
    ? `higher than ${rounded}% of ${videos}`
    : `lower than ${100 - rounded}% of ${videos}`;
};

export type StripBar = { x: number; width: number; height: number };

/** Where a strip's bars and marker go, in 0-1 of its width and height. */
export type StripGeometry = {
  bars: StripBar[];
  marker: number;
  /** Set when the value is off the training range; the marker is then pinned
   * to that end rather than drawn off the strip. */
  outside: 'below' | 'above' | null;
};

export const stripGeometry = (histogram: TrainingHistogram, value: number): StripGeometry => {
  const { edges, counts } = histogram;
  const lo = edges[0];
  const hi = edges[edges.length - 1];
  const span = hi - lo || 1;
  const tallest = Math.max(...counts, 1);
  const bars = counts.map((count, i) => ({
    x: (edges[i] - lo) / span,
    width: (edges[i + 1] - edges[i]) / span,
    height: count / tallest,
  }));
  const outside = value < lo ? 'below' : value > hi ? 'above' : null;
  const marker = outside === 'below' ? 0 : outside === 'above' ? 1 : (value - lo) / span;
  return { bars, marker, outside };
};

export type ChartPoint = { x: number; y: number | null };

/** The training videos' typical viewing per bin, plotted at each bin's centre:
 * null where the server held a sparse bin back, so the line breaks there
 * instead of bridging a gap it has no data for. */
export const typicalSeries = (
  distribution: FeatureDistribution,
): { p25: ChartPoint[]; median: ChartPoint[]; p75: ChartPoint[] } => {
  const { edges, target_p25, target_median, target_p75 } = distribution.histogram;
  const centres = edges.slice(0, -1).map((edge, i) => (edge + edges[i + 1]) / 2);
  const series = (values: (number | null)[]) =>
    centres.map((x, i) => ({ x, y: values[i] ?? null }));
  return { p25: series(target_p25), median: series(target_median), p75: series(target_p75) };
};

/** The axis range that fits both the training data and this video's value. */
export const xRange = (
  histogram: TrainingHistogram,
  value: number,
): { min: number; max: number } => {
  const { edges } = histogram;
  return { min: Math.min(edges[0], value), max: Math.max(edges[edges.length - 1], value) };
};

/** The predicted viewing against what the training videos actually got:
 * "more than 64% of the 114 training videos actually got". */
export const viewingSentence = (percentile: number, rows: number): string => {
  const videos = `the ${rows} training videos actually got`;
  if (percentile >= 100) return `more than any of ${videos}`;
  if (percentile <= 0) return `less than any of ${videos}`;
  // Kept off 0 and 100, which the lines above say in words.
  const rounded = Math.min(99, Math.max(1, Math.round(percentile)));
  return rounded >= 50
    ? `more than ${rounded}% of ${videos}`
    : `less than ${100 - rounded}% of ${videos}`;
};
