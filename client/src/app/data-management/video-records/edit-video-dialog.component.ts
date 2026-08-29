import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatDividerModule, MatDivider } from '@angular/material/divider';

@Component({
  selector: 'app-edit-video-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatIcon,
    MatDivider,
  ],
  template: `
    <h1 mat-dialog-title>Edit Video Record</h1>
    <mat-divider /><br />
    <mat-dialog-content>
      <mat-form-field appearance="outline">
        <mat-label>Sorting Name</mat-label>
        <input matInput [(ngModel)]="localData.sort_name" />
      </mat-form-field>
      <br />
      <mat-form-field appearance="outline">
        <mat-label>YouTube Content ID</mat-label>
        <input matInput [(ngModel)]="localData.youtube_content_id" />
      </mat-form-field>

      <div
        class="file-upload-container"
        style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px;"
      >
        <button mat-stroked-button color="primary" (click)="fileInput.click()">
          <mat-icon>upload</mat-icon> File
        </button>
        <span class="file-name">{{ localData.file_handle?.name }}</span>

        @if (localData.file_handle) {
          <button mat-icon-button color="warn" (click)="clearFile()" title="Clear file">
            <mat-icon>close</mat-icon>
          </button>
        }

        <input type="file" #fileInput style="display: none" (change)="onFileSelected($event)" />
      </div>

      <mat-form-field appearance="outline">
        <mat-label>Hash</mat-label>
        <input matInput [(ngModel)]="localData.file_hash" [disabled]="!!localData.file_handle" />
      </mat-form-field>
    </mat-dialog-content>

    <div
      class="file-upload-container"
      style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px;"
    >
      <button mat-stroked-button color="primary" (click)="fileInput.click()">
        <mat-icon>upload</mat-icon> YouTube Content Report
      </button>
      <span class="file-name">{{ localData.file_handle?.name || 'No file chosen' }}</span>

      @if (localData.file_handle) {
        <button mat-icon-button color="warn" (click)="clearFile()" title="Clear file">
          <mat-icon>close</mat-icon>
        </button>
      }

      <input
        type="file"
        #fileInput
        style="display: none"
        (change)="onYoutubeContentReport($event)"
      />
    </div>
    <div
      class="file-upload-container"
      style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px;"
    >
      <button mat-stroked-button color="primary" (click)="fileInput.click()">
        <mat-icon>upload</mat-icon> YouTube Content Report
      </button>
      <span class="file-name">{{ localData.file_handle?.name || 'No file chosen' }}</span>

      @if (localData.file_handle) {
        <button mat-icon-button color="warn" (click)="clearFile()" title="Clear file">
          <mat-icon>close</mat-icon>
        </button>
      }

      <input
        type="file"
        #fileInput
        style="display: none"
        (change)="onYoutubeAudienceRetention($event)"
      />
    </div>

    <mat-divider /><br />
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="onSave()">Save</button>
    </mat-dialog-actions>
  `,
})
export class EditVideoDialogComponent {
  readonly dialogRef = inject(MatDialogRef<EditVideoDialogComponent>);
  readonly data = inject<VideoRecord>(MAT_DIALOG_DATA);

  localData: VideoRecord = { ...this.data };
  //   selectedFileName: string = '';
  //   selectedFile: File | null = null;

  onFileSelected = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      //   this.selectedFile = input.files[0];
      //   this.selectedFileName = this.selectedFile.name;
      //   this.localData.file_handle = this.selectedFile;
      this.localData.file_handle = input.files[0];
      // Clear out the existing hash value since a new file will replace it upon saving
      this.localData.file_hash = undefined;
    }
  };

  onYoutubeContentReport = (event: Event): void => {
    // const input = event.target as HTMLInputElement;
    // if (input.files && input.files.length > 0) {
    //   this.selectedFile = input.files[0];
    //   this.selectedFileName = this.selectedFile.name;
    //   // Clear out the existing hash value since a new file will replace it upon saving
    //   this.localData.file_hash = undefined;
    // }
  };
  onYoutubeAudienceRetention = (event: Event): void => {
    // const input = event.target as HTMLInputElement;
    // if (input.files && input.files.length > 0) {
    //   this.selectedFile = input.files[0];
    //   this.selectedFileName = this.selectedFile.name;
    //   // Clear out the existing hash value since a new file will replace it upon saving
    //   this.localData.file_hash = undefined;
    // }
  };
  clearFile(): void {
    // this.selectedFile = null;
    // this.selectedFileName = '';
    this.localData.file_handle = undefined;
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    this.dialogRef.close({
      ...this.localData,
    });
  }
}
