import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { VideoDatabaseService } from './video-database.service';
import { buildExportCsv, downloadCsv } from './csv-export';

@Component({
  selector: 'export-records',
  template: `
    <button mat-raised-button color="primary" (click)="exportAll()">
      <mat-icon>download</mat-icon>
      Export All Records to CSV
    </button>
  `,
  imports: [MatButtonModule, MatIcon],
})
export class ExportRecordsComponent {
  private dbService = inject(VideoDatabaseService);

  async exportAll() {
    const records = await this.dbService.getAllVideos();
    const csv = buildExportCsv(records);
    downloadCsv(csv, `open-insights-export-${new Date().toISOString()}.csv`);
  }
}
