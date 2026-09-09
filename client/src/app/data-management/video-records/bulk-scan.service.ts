import { Injectable, inject, signal } from '@angular/core';
import { SelectionService } from './selection.service';
import { VideoDatabaseService } from './video-database.service';
import { DatasetActionsService } from './dataset-actions.service';
import { VideoRecord } from './VideoRecord';

export type ScanAction = 'upload' | 'transcript' | 'transcriptStats' | 'sceneStats';

const SCAN_LABELS: Record<ScanAction, string> = {
  upload: 'Uploading',
  transcript: 'Extracting transcript',
  transcriptStats: 'Extracting transcript stats',
  sceneStats: 'Extracting scene stats',
};

/** A record with no file attached this session cannot be uploaded, and that is
 * neither a success nor a failure - reporting it as either would misdescribe a
 * run over a library that was imported without its videos. */
type ScanOutcome = void | 'skipped';

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

  private readonly actions: Record<ScanAction, (record: VideoRecord) => Promise<ScanOutcome>> = {
    // Uploading ahead of a scan is worth doing on its own: otherwise every
    // upload happens lazily on the first dataset request that 404s, which puts
    // them in amongst the compute rather than before it.
    upload: async (record) =>
      (await this.datasetActions.uploadFile(record)) === 'no-local-file' ? 'skipped' : undefined,
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
    let skipped = 0;

    try {
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        this.setStatus(action, `${label}: ${i + 1} of ${records.length}...`);
        try {
          if ((await this.actions[action](record)) === 'skipped') skipped++;
          else succeeded++;
          await this.dbService.updateVideo(record);
        } catch (error) {
          console.error(`${label} failed for record ${record.__id}:`, error);
          failed++;
          // A failed action still leaves the record marked 'failed', exactly as a row click
          // does - worth keeping. Best-effort: a write failure must not abort the whole run.
          await this.dbService.updateVideo(record).catch(() => undefined);
        }
      }
      const skippedNote = skipped > 0 ? `, ${skipped} skipped (no file attached)` : '';
      this.setStatus(action, `Done: ${succeeded} succeeded, ${failed} failed${skippedNote}.`);
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
