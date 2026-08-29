import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { DataManagementPage } from './data-management-page';
import { VideoManagerComponent } from './video-manager.component';

/**
 * @title Basic use of the tab group
 */
@Component({
  selector: 'view-manager',
  template: `
    <mat-tab-group>
      <mat-tab label="Data Management"> <data-management-page /><app-video-manager /> </mat-tab>
      <mat-tab label="Analysis">WIP</mat-tab>
    </mat-tab-group>
  `,
  imports: [MatTabsModule, DataManagementPage, VideoManagerComponent],
})
export class ViewManager {}
