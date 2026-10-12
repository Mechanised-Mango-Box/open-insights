/**
 * The set of things the sidebar can show, shared by ViewManager (which renders the nav)
 * and HomeComponent (whose instructions link straight to a step). Kept out of both
 * components so neither has to import the other.
 */
export type ViewId =
  | 'home'
  | 'import'
  | 'scan'
  | 'export'
  | 'analysis'
  | 'recommend'
  | 'recommend-model'
  | 'recommend-results'
  | 'settings';

/**
 * A view with subpages is never shown itself: the sidebar lists the subpages beneath it,
 * and going to the parent lands on whichever of them was open last.
 */
export type View = { id: ViewId; label: string; icon: string; blurb: string; subpages?: View[] };

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
    blurb:
      'Bring in YouTube reports, video files or an earlier export, with a guide to getting each.',
  },
  {
    id: 'scan',
    label: 'Scan',
    icon: 'search',
    blurb:
      'Extract transcripts, scene stats, screen text and audio stats across the selected records.',
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
    blurb: 'Correlations and distributions across your records, or just the selected ones.',
  },
  {
    id: 'recommend',
    label: 'Recommend',
    icon: 'online_prediction',
    blurb: "Choose one of the server's models and ask what it makes of a single video.",
    subpages: [
      {
        id: 'recommend-model',
        label: 'Model',
        icon: 'model_training',
        blurb: "Choose which of the server's models to ask, and read what its card says about it.",
      },
      {
        id: 'recommend-results',
        label: 'Results',
        icon: 'query_stats',
        blurb: 'Pick one video and read what the chosen model makes of it.',
      },
    ],
  },
];

export const SETTINGS: View = {
  id: 'settings',
  label: 'Settings',
  icon: 'settings',
  blurb: 'Choose which server this browser talks to, and check that it answers.',
};

/**
 * The record table is the working set the first three steps all act on - Scan in particular
 * reads the table's selection - so it stays on screen for each of them, exactly as it did
 * beneath the old Data Management tab group.
 *
 * Recommend is deliberately absent: it acts on exactly one video, which it picks from its own
 * single-choice list rather than from this multi-select table.
 */
export const VIEWS_WITH_RECORDS: ReadonlySet<ViewId> = new Set<ViewId>([
  'import',
  'scan',
  'export',
]);
