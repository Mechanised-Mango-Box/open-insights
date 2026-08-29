import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { FetchTestComponent } from '../data-management/fetch-test.component';
import { VideoTableComponent } from '../data-management/video-table.component';
import { VideoRecordsImport } from '../data-management/video-records/video-records-import.component';

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
          <mat-tab label="Scan"> <fetch-test /> </mat-tab>
          <mat-tab label="Export"> WIP</mat-tab>
        </mat-tab-group>
        <h2>Records</h2>
        <video-table />
      </mat-tab>
      <mat-tab label="Analysis">WIP</mat-tab>
    </mat-tab-group>
  `,
  imports: [MatTabsModule, FetchTestComponent, VideoTableComponent, VideoRecordsImport],
})
export class ViewManager {}
