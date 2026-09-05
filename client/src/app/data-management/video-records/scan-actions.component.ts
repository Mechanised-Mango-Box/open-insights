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
    <div class="scan-actions">
      <p>{{ selectionService.selectedCount() }} record(s) selected.</p>

      <div class="scan-action">
        <button
          mat-raised-button
          color="primary"
          [disabled]="selectionService.isEmpty() || scans.isRunning('transcript')"
          (click)="scans.run('transcript')"
        >
          Extract Transcript
        </button>
        @if (scans.statusFor('transcript')) {
        <span class="scan-status">{{ scans.statusFor('transcript') }}</span>
        }
      </div>

      <div class="scan-action">
        <button
          mat-raised-button
          [disabled]="selectionService.isEmpty() || scans.isRunning('transcriptStats')"
          (click)="scans.run('transcriptStats')"
        >
          Extract Transcript Stats
        </button>
        @if (scans.statusFor('transcriptStats')) {
        <span class="scan-status">{{ scans.statusFor('transcriptStats') }}</span>
        }
      </div>

      <div class="scan-action">
        <button
          mat-raised-button
          color="accent"
          [disabled]="selectionService.isEmpty() || scans.isRunning('sceneStats')"
          (click)="scans.run('sceneStats')"
        >
          Extract Scene Stats
        </button>
        @if (scans.statusFor('sceneStats')) {
        <span class="scan-status">{{ scans.statusFor('sceneStats') }}</span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .scan-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        padding: 16px 0;
      }
      .scan-action {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .scan-status {
        color: #9e9e9e;
      }
    `,
  ],
})
export class ScanActionsComponent {
  selectionService = inject(SelectionService);
  scans = inject(BulkScanService);
}
