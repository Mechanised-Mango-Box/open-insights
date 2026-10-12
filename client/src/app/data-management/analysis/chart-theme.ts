/**
 * The charts are a deliberate light island in an otherwise dark app: a white surface with
 * dark ink, both on the page and in the exported PNGs. Keeping the two identical means a
 * chart reads on screen exactly as it will in whatever report it gets dropped into, and
 * there is no second theme to keep in step.
 *
 * The values are the dataviz palette's light-mode column, validated as a set (CVD
 * separation + contrast) against this white surface. Shared by the Analysis charts and
 * the Recommend step's training-data chart, so the two read as one system.
 */
export const CHART_SURFACE = '#ffffff';
export const CHART_INK = '#0b0b0b';
export const CHART_MUTED_INK = '#52514e';
export const CHART_GRID = '#e1e0d9';

export const PALETTE = {
  positive: '#2a78d6',
  negative: '#e34948',
  histogram: '#2a78d6',
  scatterPoint: 'rgba(137, 135, 129, 0.7)',
  trend: '#eb6834',
} as const;
