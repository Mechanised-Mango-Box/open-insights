import { DatasetState, LOCAL_IMPORT, LOCAL_RECOMPUTE } from './Dataset';
import { DatasetStatus } from '../dataset-server.service';

export type ServerStatus = 'checking' | 'exists' | 'missing' | 'error';

/**
 * A server-reported dataset state, plus the two states that are purely local to
 * this browser and have no server equivalent: 'checking' (a request is in
 * flight) and 'error' (the server could not be reached at all). Keeping those
 * two visibly separate from DatasetStatus is deliberate - conflating "the
 * server says nothing has run" with "we could not ask" is what made the old
 * vocabularies impossible to line up.
 */
export type DatasetPeekResult = { status: DatasetStatus | 'checking' | 'error'; error?: string };
export type StatusIcon = { icon: string; label: string; cssClass: string };

/** Icon/label for whether a video file is known to exist on the server. */
export function serverStatusIcon(
  status: ServerStatus,
  opts: { hasLocalFile: boolean; uploading: boolean },
): StatusIcon {
  if (opts.uploading) {
    return { icon: 'cloud_upload', label: 'Uploading...', cssClass: 'status-checking' };
  }
  switch (status) {
    case 'checking':
      return { icon: 'hourglass_empty', label: 'Checking server...', cssClass: 'status-checking' };
    case 'exists':
      return { icon: 'cloud_done', label: 'Video exists on server', cssClass: 'status-exists' };
    case 'missing':
      return opts.hasLocalFile
        ? {
            icon: 'cloud_upload',
            label: 'Video not on server - click to upload',
            cssClass: 'status-missing',
          }
        : {
            icon: 'cloud_off',
            label: 'Video not on server - attach a file first',
            cssClass: 'status-missing',
          };
    case 'error':
      return { icon: 'error_outline', label: 'Could not reach server', cssClass: 'status-error' };
  }
}

/** Icon/label for a peeked async server job's status (transcript/scene-stats generation). */
export function datasetPeekStatusIcon(result: DatasetPeekResult): StatusIcon {
  switch (result.status) {
    case 'checking':
      return { icon: 'hourglass_empty', label: 'Checking status...', cssClass: 'status-checking' };
    case 'absent':
      return { icon: 'radio_button_unchecked', label: 'Not started', cssClass: 'status-missing' };
    case 'queued':
      return { icon: 'schedule', label: 'Queued...', cssClass: 'status-checking' };
    case 'running':
      return { icon: 'sync', label: 'Processing...', cssClass: 'status-checking' };
    // Deliberately not green: the job finished, but this browser holds none of the result,
    // so the record still exports nothing and still doesn't count toward the analysis.
    // Green is reserved for 'the data is here' - see datasetStateIcon.
    //
    // cloud_queue rather than cloud_download, because this badge does not download: the table
    // renders a real download button beside it in exactly this state, and two identical
    // cloud_download icons side by side would hide which of them is the one that acts.
    case 'ready':
      return {
        icon: 'cloud_queue',
        label: 'Ready on server - not fetched yet',
        cssClass: 'status-missing',
      };
    case 'failed':
      return { icon: 'error_outline', label: `Failed: ${result.error}`, cssClass: 'status-error' };
    case 'error':
      return { icon: 'error_outline', label: 'Could not reach server', cssClass: 'status-error' };
  }
}

/**
 * Icon/label for a dataset value this browser actually holds.
 *
 * Replaces the old uploadStateIcon: nothing here was ever uploaded. The click
 * runs DatasetActionsService.fetchTranscript/fetchSceneStats, which re-runs
 * generation server-side and overwrites this copy - there is no endpoint that
 * accepts local edits, so nothing here ever travels upwards. `producer` now
 * records what made the value, which is the question the old `is_local` boolean
 * was standing in for.
 */
export function datasetStateIcon(
  value: DatasetState<unknown> | undefined,
  sending: boolean,
): StatusIcon | null {
  if (sending) {
    return { icon: 'hourglass_empty', label: 'Syncing with server...', cssClass: 'status-checking' };
  }
  if (!value) return null;

  switch (value.state) {
    case 'absent':
      return null;
    case 'queued':
      return { icon: 'schedule', label: 'Queued on server...', cssClass: 'status-checking' };
    case 'running':
      return { icon: 'hourglass_empty', label: 'Generating on server...', cssClass: 'status-checking' };
    case 'failed':
      return {
        icon: 'cloud_off',
        label: `Failed: ${value.error} - click to retry`,
        cssClass: 'status-error',
      };
    case 'ready':
      // The data is here and usable in every branch below; these differ only in
      // how much it can be trusted to match what the server would produce now.
      if (value.refresh_error) {
        return {
          icon: 'cloud_off',
          label: `Held, but the last refresh failed (${value.refresh_error}) - click to retry`,
          cssClass: 'status-error',
        };
      }
      if (value.refreshing) {
        return {
          icon: 'hourglass_empty',
          label: 'Held - a newer version is generating...',
          cssClass: 'status-checking',
        };
      }
      if (value.producer === LOCAL_IMPORT || value.producer === LOCAL_RECOMPUTE) {
        return {
          icon: 'cloud_queue',
          label: "Local only - click to replace with the server's version",
          cssClass: 'status-missing',
        };
      }
      return { icon: 'cloud_done', label: `Synced with server (${value.producer})`, cssClass: 'status-exists' };
  }
}

/** Shared styling for the `.server-status` icon/label pattern used across status badges. */
export const STATUS_ICON_STYLES = `
  .server-status.status-exists {
    color: #2e7d32;
  }
  .server-status.status-missing {
    color: #9e9e9e;
  }
  .server-status.status-error {
    color: #c62828;
  }
  .server-status.status-checking {
    color: #9e9e9e;
  }
  .error-text {
    color: #c62828;
  }
`;
