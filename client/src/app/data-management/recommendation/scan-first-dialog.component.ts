import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { SCAN_STEP_LABELS, ScanStep } from './scan-first';

export type ScanFirstDialogData = {
  name: string;
  steps: ScanStep[];
  /** False when the record has no video file, so there is nothing to scan. */
  canScan: boolean;
};

/**
 * Stands between an unscanned video and the recommendation request: the model
 * cannot score a video without its scene and transcript stats, so rather than
 * refuse outright, this offers to do the missing Scan work and then send it.
 *
 * Closes with true only for "Scan, then submit". Dismissing it any other way
 * sends nothing and starts nothing.
 */
@Component({
  selector: 'scan-first-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Scan this video first?</h2>

    <mat-dialog-content>
      <p>
        <strong>{{ data.name }}</strong> has not been fully scanned, and the model needs its scene
        and transcript stats to make a prediction. Still missing:
      </p>
      <ul>
        @for (step of data.steps; track step) {
          <li>{{ labels[step] }}</li>
        }
      </ul>

      @if (data.canScan) {
        <p class="note">
          Scanning runs where your current processing settings send it, the same as the Scan step,
          and can take several minutes for a long video. The results are saved to the record, and
          the video is sent for recommendations once they are in.
        </p>
      } @else {
        <p class="note">
          It has no video file attached, so it cannot be scanned. Attach its file from the records
          table on the Import or Scan step, then try again.
        </p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button type="button" mat-dialog-close>Cancel</button>
      @if (data.canScan) {
        <button mat-raised-button color="primary" type="button" [mat-dialog-close]="true">
          Scan, then submit
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [
    `
      ul {
        margin: 0 0 12px;
      }
      .note {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
      }
    `,
  ],
})
export class ScanFirstDialogComponent {
  protected data = inject<ScanFirstDialogData>(MAT_DIALOG_DATA);
  protected readonly labels = SCAN_STEP_LABELS;
}
