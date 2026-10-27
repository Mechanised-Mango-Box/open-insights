import { FeatureRowResult } from './analysis.service';
import { DEFAULT_THRESHOLD, MIN_ROWS_FOR_RECOMMENDATIONS } from './recommendations';
import {
  ANALYSIS_FEATURE_COLUMNS,
  FEATURE_DEFINITIONS,
  FEATURE_LABELS,
  FEATURE_SOURCES,
  HISTOGRAM_BINS,
  LOESS_FRAC,
  LOESS_POINTS,
  TARGET_DEFINITION,
} from './stats';

export type MethodEntry = { label: string; text: string };

/**
 * What produced an analysis: which records it used and why it left the others
 * out, which technique made each figure, and the constants they ran with.
 *
 * Built from the same constants the computation reads (stats.ts,
 * recommendations.ts), never typed out a second time, so the page and the
 * export's methods.json cannot describe a calculation that differs from the one
 * that ran.
 */
export type AnalysisMethods = {
  records: {
    used: number;
    total: number;
    skipped: { reason: string; count: number }[];
  };
  target: string;
  features: { key: string; label: string; definition: string; scans: string[] }[];
  techniques: MethodEntry[];
  constants: {
    histogram_bins: number;
    loess_frac: number;
    loess_points: number;
    relationship_threshold: number;
    min_rows_for_relationships: number;
  };
};

const SCAN_NAMES: Record<string, string> = {
  sceneStats: 'scene stats',
  transcriptStats: 'transcript',
  textStats: 'screen text',
  audioStats: 'audio stats',
};

export const buildAnalysisMethods = (rowResult: FeatureRowResult): AnalysisMethods => ({
  records: {
    used: rowResult.eligibleCount,
    total: rowResult.totalCount,
    skipped: rowResult.skipped,
  },
  target: TARGET_DEFINITION,
  features: ANALYSIS_FEATURE_COLUMNS.map((key) => ({
    key,
    label: FEATURE_LABELS[key],
    definition: FEATURE_DEFINITIONS[key],
    // Every feature here reads its duration from scene stats: the full set has a
    // scene feature (durationSourceFor).
    scans: [...new Set(['sceneStats', ...FEATURE_SOURCES[key]])].map((s) => SCAN_NAMES[s]),
  })),
  techniques: [
    {
      label: 'Correlation',
      text:
        'Pearson correlation coefficient (r) between each feature and average percentage ' +
        'viewed, over every record used. Ranges from -1 to +1; it measures a straight-line ' +
        'association only. A feature with no variation is reported as 0.',
    },
    {
      label: 'Distribution',
      text:
        `Histogram of each feature in ${HISTOGRAM_BINS} equal-width bins from its minimum to ` +
        'its maximum (numpy.histogram semantics: the last bin includes its right edge).',
    },
    {
      label: 'Trend line',
      text:
        'LOESS: at each of ' +
        `${LOESS_POINTS} evenly spaced points, a straight line is fitted to the nearest ` +
        `${Math.round(LOESS_FRAC * 100)}% of records, weighted by the tricube of their ` +
        'distance, and its value at that point is plotted.',
    },
    {
      label: 'Relationships',
      text:
        'Ordinary least squares regression of average percentage viewed on all features ' +
        'together, after standardising each to a z-score (population standard deviation, ' +
        "as scikit-learn's StandardScaler does), solved by the normal equations. A " +
        `coefficient at or above +${DEFAULT_THRESHOLD} reads as positive, at or below ` +
        `-${DEFAULT_THRESHOLD} as negative, and in between as weak - a practical-effect ` +
        'threshold in points of viewing per standard deviation, not a significance test. ' +
        `Needs at least ${MIN_ROWS_FOR_RECOMMENDATIONS} records, and is not reported when ` +
        'the features are perfectly collinear.',
    },
  ],
  constants: {
    histogram_bins: HISTOGRAM_BINS,
    loess_frac: LOESS_FRAC,
    loess_points: LOESS_POINTS,
    relationship_threshold: DEFAULT_THRESHOLD,
    min_rows_for_relationships: MIN_ROWS_FOR_RECOMMENDATIONS,
  },
});
