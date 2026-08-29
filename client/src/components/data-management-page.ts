import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { FileUploader } from './file-uploader';
import { EntityListComponent } from '../entity-manager/e-m';
import { FetchTestComponent } from './fetch-test';

/**
 * @title Basic use of the tab group
 */
@Component({
  selector: 'data-management-page',
  template: `
    <mat-tab-group>
      <mat-tab label="Import"><test-add /></mat-tab>
      <mat-tab label="Export"> WIP</mat-tab>
      <mat-tab label="TEST FETCH"> <fetch-test /> </mat-tab>
      <mat-tab label="Transcript"> WIP</mat-tab>
      <mat-tab label="Scenes"> WIP</mat-tab>
      <mat-tab label="DEPRECATED IndexDB"> <file-uploader /></mat-tab>
    </mat-tab-group>
  `,
  imports: [MatTabsModule, FileUploader, EntityListComponent, FetchTestComponent],
})
export class DataManagementPage {}
