import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SelectionService } from './selection.service';
import { buildExportZip, downloadBlob } from './manifest-export';

/** Sized in binary units, so the figure matches what a file manager reports for the zip. */
const formatBytes = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit > 0 && value < 10 ? 1 : 0)} ${units[unit]}`;
};

/**
 * The Export step. Acts on the table's selection rather than the whole database, so it's the
 * same working set the other steps use - which is also why the video files are optional here:
 * they're usually the bulk of the zip, and a dataset being handed to the analysis side of
 * things rarely needs them.
 */
@Component({
  selector: 'export-records',
  template: `
    <section class="card actions-column">
      <mat-slide-toggle
        [checked]="includeVideoFiles()"
        (change)="includeVideoFiles.set($event.checked)"
      >
        Include video files
      </mat-slide-toggle>

      @if (videoFiles().count > 0) {
        <p class="action-hint">
          {{ videoFiles().count }} of the {{ selectionService.selectedCount() }} selected record(s)
          have their video file in this browser, totalling {{ formatBytes(videoFiles().bytes) }}.
        </p>
      }

      <div class="actions">
        <button
          mat-raised-button
          color="primary"
          [disabled]="selectionService.isEmpty() || pending()"
          (click)="exportSelected()"
        >
          <mat-icon>download</mat-icon>
          Export Selected
        </button>
        @if (status()) {
          <p class="action-status">{{ status() }}</p>
        }
      </div>

      <!-- After the button, not before: this explains why it is greyed out, which is
           read having already found it greyed out. The toggle and its size hint go
           above because they change what the button will do. -->
      @if (selectionService.isEmpty()) {
        <p class="action-hint">Tick the records you want in the table below.</p>
      }
    </section>
  `,
  imports: [MatButtonModule, MatIcon, MatSlideToggleModule],
})
export class ExportRecordsComponent {
  protected readonly selectionService = inject(SelectionService);
  protected readonly formatBytes = formatBytes;

  includeVideoFiles = signal(true);
  pending = signal(false);
  status = signal<string | null>(null);

  /** How much of the zip the video files would account for, to inform the toggle. */
  protected readonly videoFiles = computed(() => {
    // Read through selectedCount, the signal SelectionService bridges selection.changed
    // into - `selection.selected` on its own is a plain array this wouldn't track.
    this.selectionService.selectedCount();
    const files = this.selectionService.selection.selected
      .map((record) => record.video_file.file)
      .filter((file) => file !== null);
    return {
      count: files.length,
      bytes: files.reduce((total, file) => total + file.size, 0),
    };
  });

  async exportSelected() {
    const records = this.selectionService.selection.selected;
    if (records.length === 0) return;

    this.pending.set(true);
    this.status.set('Preparing export...');
    try {
      const blob = await buildExportZip(records, {
        includeVideoFiles: this.includeVideoFiles(),
        onProgress: (done, total) => this.status.set(`Zipping ${done} of ${total} record(s)...`),
      });
      downloadBlob(blob, `open-insights-export-${new Date().toISOString()}.zip`);
      this.status.set(`Exported ${records.length} record(s).`);
    } catch (error) {
      console.error('Export failed:', error);
      this.status.set('Export failed - see console for details.');
    } finally {
      this.pending.set(false);
    }
  }
}
