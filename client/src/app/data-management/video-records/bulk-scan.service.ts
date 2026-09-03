import { Injectable, inject, signal } from '@angular/core';
import { SelectionService } from './selection.service';
import { VideoDatabaseService } from './video-database.service';
import { DatasetActionsService } from './dataset-actions.service';
import { VideoRecord } from './VideoRecord';

export type ScanAction = 'transcript' | 'transcriptStats' | 'sceneStats';

const SCAN_LABELS: Record<ScanAction, string> = {
  transcript: 'transcript',
  transcriptStats: 'transcript stats',
  sceneStats: 'scene stats',
};

/**
 * Runs a DatasetActionsService action across the current selection - the Scan tab's buttons, and
 * the only thing that separates them from the table's per-row buttons.
 *
 * Root-provided rather than component state because the Scan tab's body is destroyed the moment
 * you switch inner tabs (Material detaches the tab body portal unless `preserveContent`), which
 * would otherwise re-enable the buttons and lose the progress text half way through a run.
 *
 * Progress is tracked per action, so a long transcript run leaves the other two buttons live: they
 * write different fields of the record, the server queues its jobs per video, and updateVideo puts
 * the whole record, so concurrent runs can't lose each other's writes.
 */
@Injectable({
  providedIn: 'root',
})
export class BulkScanService {
  private selectionService = inject(SelectionService);
  private dbService = inject(VideoDatabaseService);
  private datasetActions = inject(DatasetActionsService);

  private running = signal<Set<ScanAction>>(new Set());
  private progress = signal<Map<ScanAction, string>>(new Map());

  private readonly actions: Record<ScanAction, (record: VideoRecord) => Promise<void>> = {
    transcript: (record) => this.datasetActions.fetchTranscript(record),
    transcriptStats: async (record) => this.datasetActions.recomputeTranscriptStats(record),
    sceneStats: (record) => this.datasetActions.fetchSceneStats(record),
  };

  isRunning = (action: ScanAction): boolean => this.running().has(action);

  /** Progress/outcome text for one action, or null if it hasn't been run this session. */
  statusFor = (action: ScanAction): string | null => this.progress().get(action) ?? null;

  async run(action: ScanAction): Promise<void> {
    if (this.isRunning(action)) return;

    const records = this.selectionService.selection.selected;
    if (records.length === 0) return;

    const label = SCAN_LABELS[action];
    this.setRunning(action, true);
    let succeeded = 0;
    let failed = 0;

    try {
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        this.setStatus(action, `Extracting ${label}: ${i + 1} of ${records.length}...`);
        try {
          await this.actions[action](record);
          await this.dbService.updateVideo(record);
          succeeded++;
        } catch (error) {
          console.error(`Failed to extract ${label} for record ${record.__id}:`, error);
          failed++;
          // A failed action still leaves the record marked 'failed', exactly as a row click
          // does - worth keeping. Best-effort: a write failure must not abort the whole run.
          await this.dbService.updateVideo(record).catch(() => undefined);
        }
      }
      this.setStatus(action, `Done: ${succeeded} succeeded, ${failed} failed.`);
    } finally {
      this.setRunning(action, false);
    }
  }

  private setRunning(action: ScanAction, isRunning: boolean): void {
    this.running.update((set) => {
      const next = new Set(set);
      if (isRunning) next.add(action);
      else next.delete(action);
      return next;
    });
  }

  private setStatus(action: ScanAction, status: string): void {
    this.progress.update((map) => new Map(map).set(action, status));
  }
}
