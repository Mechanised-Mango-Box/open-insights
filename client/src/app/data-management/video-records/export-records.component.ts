import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { VideoDatabaseService } from './video-database.service';
import { buildExportZip, downloadBlob } from './manifest-export';

@Component({
  selector: 'export-records',
  template: `
    <button mat-raised-button color="primary" [disabled]="pending()" (click)="exportAll()">
      <mat-icon>download</mat-icon>
      Export All Records
    </button>
    @if (status()) {
      <p>{{ status() }}</p>
    }
  `,
  imports: [MatButtonModule, MatIcon],
})
export class ExportRecordsComponent {
  private dbService = inject(VideoDatabaseService);

  pending = signal(false);
  status = signal<string | null>(null);

  async exportAll() {
    this.pending.set(true);
    this.status.set('Preparing export...');
    try {
      const records = await this.dbService.getAllVideos();
      const blob = await buildExportZip(records, (done, total) => {
        this.status.set(`Zipping ${done} of ${total} record(s)...`);
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
