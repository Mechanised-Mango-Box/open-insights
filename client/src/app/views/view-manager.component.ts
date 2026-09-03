import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { VideoTableComponent } from '../data-management/video-records/video-table.component';
import { VideoRecordsImport } from '../data-management/video-records/video-records-import.component';
import { ExportRecordsComponent } from '../data-management/video-records/export-records.component';
import { ScanActionsComponent } from '../data-management/video-records/scan-actions.component';
import { AnalysisComponent } from '../data-management/analysis/analysis.component';
import { ServerSettingsComponent } from '../data-management/server-settings.component';

/**
 * @title Basic use of the tab group
 */
@Component({
  selector: 'view-manager',
  template: `
    <mat-tab-group>
      <mat-tab label="Data Management">
        <mat-tab-group>
          <mat-tab label="New/Import"> <video-records-import /></mat-tab>
          <mat-tab label="Scan"> <scan-actions /> </mat-tab>
          <mat-tab label="Export"> <export-records /> </mat-tab>
        </mat-tab-group>
        <h2>Records</h2>
        <video-table />
      </mat-tab>
      <mat-tab label="Analysis">
        @defer (on idle) {
          <analysis />
        } @placeholder {
          <p>Loading analysis…</p>
        }
      </mat-tab>
      <mat-tab label="Settings"><server-settings /></mat-tab>
    </mat-tab-group>
  `,
  imports: [
    MatTabsModule,
    VideoTableComponent,
    VideoRecordsImport,
    ExportRecordsComponent,
    ScanActionsComponent,
    AnalysisComponent,
    ServerSettingsComponent,
  ],
})
export class ViewManager {}
