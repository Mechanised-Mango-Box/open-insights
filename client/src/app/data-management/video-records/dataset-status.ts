import { Cacheable } from './Dataset';
import { DatasetStatus } from '../dataset-server.service';

export type ServerStatus = 'checking' | 'exists' | 'missing' | 'error';
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
        ? { icon: 'cloud_upload', label: 'Video not on server - click to upload', cssClass: 'status-missing' }
        : { icon: 'cloud_off', label: 'Video not on server - attach a file first', cssClass: 'status-missing' };
    case 'error':
      return { icon: 'error_outline', label: 'Could not reach server', cssClass: 'status-error' };
  }
}

/** Icon/label for a peeked async server job's status (transcript/scene-stats generation). */
export function datasetPeekStatusIcon(result: DatasetPeekResult): StatusIcon {
  switch (result.status) {
    case 'checking':
      return { icon: 'hourglass_empty', label: 'Checking status...', cssClass: 'status-checking' };
    case 'not_started':
      return { icon: 'radio_button_unchecked', label: 'Not started', cssClass: 'status-missing' };
    case 'processing':
      return { icon: 'sync', label: 'Processing...', cssClass: 'status-checking' };
    case 'complete':
      return { icon: 'check_circle', label: 'Complete', cssClass: 'status-exists' };
    case 'failed':
      return { icon: 'error_outline', label: `Failed: ${result.error}`, cssClass: 'status-error' };
    case 'error':
      return { icon: 'error_outline', label: 'Could not reach server', cssClass: 'status-error' };
  }
}

/**
 * Icon/label for a Cacheable<T>'s upload_state: whether this locally-held dataset value
 * is known-synced with the server, still local-only, or failed to sync.
 */
export function uploadStateIcon(cacheable: Cacheable<unknown> | null, sending: boolean): StatusIcon | null {
  if (sending) {
    return { icon: 'hourglass_empty', label: 'Sending to server...', cssClass: 'status-checking' };
  }
  if (!cacheable) return null;
  const state = cacheable.upload_state;
  if (!state.is_local) {
    return { icon: 'cloud_done', label: 'Synced with server', cssClass: 'status-exists' };
  }
  switch (state.server_side_state) {
    case 'ready':
      return { icon: 'cloud_upload', label: 'Local only - click to send to server', cssClass: 'status-missing' };
    case 'in_progress':
      return { icon: 'hourglass_empty', label: 'Sending to server...', cssClass: 'status-checking' };
    case 'failed':
      return { icon: 'cloud_off', label: 'Failed to sync with server - click to retry', cssClass: 'status-error' };
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
