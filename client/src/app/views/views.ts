/**
 * The set of things the sidebar can show, shared by ViewManager (which renders the nav)
 * and HomeComponent (whose instructions link straight to a step). Kept out of both
 * components so neither has to import the other.
 */
export type ViewId = 'home' | 'import' | 'scan' | 'export' | 'analysis' | 'settings';

export type View = { id: ViewId; label: string; icon: string; blurb: string };

/** Reached by clicking the app name at the top of the sidebar, not by a nav item. */
export const HOME: View = {
  id: 'home',
  label: 'Overview',
  icon: 'home',
  blurb: 'What Open Insights does, and how to work through it.',
};

/**
 * The steps run top to bottom in the order a dataset is actually built: records come in,
 * get scanned, then leave as a zip - with Analysis reading whatever is there by then.
 */
export const WORKFLOW: View[] = [
  {
    id: 'import',
    label: 'Import',
    icon: 'add',
    blurb: 'Create records, or bring them in from a YouTube content export or video files.',
  },
  {
    id: 'scan',
    label: 'Scan',
    icon: 'search',
    blurb: 'Extract transcripts and scene stats across the selected records.',
  },
  {
    id: 'export',
    label: 'Export',
    icon: 'download',
    blurb: 'Download the selected records as a zip: manifest, transcripts and media.',
  },
  {
    id: 'analysis',
    label: 'Analysis',
    icon: 'insert_chart',
    blurb: 'Correlations and distributions across the whole dataset.',
  },
];

export const SETTINGS: View = {
  id: 'settings',
  label: 'Settings',
  icon: 'settings',
  blurb: 'Choose which dataset server this browser talks to.',
};

/**
 * The record table is the working set the first three steps all act on - Scan in particular
 * reads the table's selection - so it stays on screen for each of them, exactly as it did
 * beneath the old Data Management tab group.
 */
export const VIEWS_WITH_RECORDS: ReadonlySet<ViewId> = new Set<ViewId>([
  'import',
  'scan',
  'export',
]);
