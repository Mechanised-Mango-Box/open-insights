import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { SelectionService } from './selection.service';
import { BulkScanService } from './bulk-scan.service';

/**
 * The Scan tab's bulk buttons. Each runs the very same action the table's per-row buttons run
 * (see DatasetActionsService) - the only difference is that it's applied across the selection.
 *
 * Each button is disabled only by its own run, so a long transcript scan doesn't lock up the
 * other two; BulkScanService holds that state so it survives leaving and re-entering the tab.
 */
@Component({
  selector: 'scan-actions',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    <div class="actions-column">
      <p class="action-status">{{ selectionService.selectedCount() }} record(s) selected.</p>

      <div class="actions">
        <button
          mat-stroked-button
          [disabled]="selectionService.isEmpty() || scans.isRunning('upload')"
          (click)="scans.run('upload')"
        >
          Upload to Server
        </button>
        @if (scans.statusFor('upload')) {
          <span class="action-status">{{ scans.statusFor('upload') }}</span>
        }
      </div>
      <p class="action-hint">
        Uploading first is optional — an extract sends any video the server is missing. Doing it as
        its own pass keeps the transfers out of the way of the work.
      </p>

      <div class="actions">
        <button
          mat-stroked-button
          [disabled]="selectionService.isEmpty() || scans.isRunning('transcript')"
          (click)="scans.run('transcript')"
        >
          Extract Transcript
        </button>
        @if (scans.statusFor('transcript')) {
          <span class="action-status">{{ scans.statusFor('transcript') }}</span>
        }
      </div>

      <div class="actions">
        <button
          mat-stroked-button
          [disabled]="selectionService.isEmpty() || scans.isRunning('transcriptStats')"
          (click)="scans.run('transcriptStats')"
        >
          Extract Transcript Stats
        </button>
        @if (scans.statusFor('transcriptStats')) {
          <span class="action-status">{{ scans.statusFor('transcriptStats') }}</span>
        }
      </div>

      <div class="actions">
        <button
          mat-stroked-button
          [disabled]="selectionService.isEmpty() || scans.isRunning('sceneStats')"
          (click)="scans.run('sceneStats')"
        >
          Extract Scene Stats
        </button>
        @if (scans.statusFor('sceneStats')) {
          <span class="action-status">{{ scans.statusFor('sceneStats') }}</span>
        }
      </div>
    </div>
  `,
})
export class ScanActionsComponent {
  selectionService = inject(SelectionService);
  scans = inject(BulkScanService);
}
