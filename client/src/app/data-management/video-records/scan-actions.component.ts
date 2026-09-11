import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
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
  imports: [MatButtonModule, MatIcon],
  template: `
    <section class="card actions-column">
      <p class="action-hint">{{ selectionService.selectedCount() }} record(s) selected.</p>

      <div class="actions">
        <button
          mat-stroked-button
          [disabled]="selectionService.isEmpty() || scans.isRunning('upload')"
          (click)="scans.run('upload')"
        >
          <mat-icon>cloud_upload</mat-icon>
          Upload to Server
        </button>
        @if (scans.statusFor('upload')) {
          <p class="action-status">{{ scans.statusFor('upload') }}</p>
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
          <mat-icon>subtitles</mat-icon>
          Extract Transcript
        </button>
        @if (scans.statusFor('transcript')) {
          <p class="action-status">{{ scans.statusFor('transcript') }}</p>
        }
      </div>

      <div class="actions">
        <button
          mat-stroked-button
          [disabled]="selectionService.isEmpty() || scans.isRunning('transcriptStats')"
          (click)="scans.run('transcriptStats')"
        >
          <mat-icon>speed</mat-icon>
          Extract Transcript Stats
        </button>
        @if (scans.statusFor('transcriptStats')) {
          <p class="action-status">{{ scans.statusFor('transcriptStats') }}</p>
        }
      </div>

      <div class="actions">
        <button
          mat-stroked-button
          [disabled]="selectionService.isEmpty() || scans.isRunning('sceneStats')"
          (click)="scans.run('sceneStats')"
        >
          <mat-icon>movie_filter</mat-icon>
          Extract Scene Stats
        </button>
        @if (scans.statusFor('sceneStats')) {
          <p class="action-status">{{ scans.statusFor('sceneStats') }}</p>
        }
      </div>
    </section>
  `,
})
export class ScanActionsComponent {
  selectionService = inject(SelectionService);
  scans = inject(BulkScanService);
}
