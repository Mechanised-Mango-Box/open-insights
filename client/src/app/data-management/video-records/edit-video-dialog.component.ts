import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';

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
  ],
  template: `
    <h1 mat-dialog-title>Edit Video Record</h1>
    <mat-dialog-content>
      <p>
        <mat-form-field appearance="outline">
          <mat-label>YouTube Content ID</mat-label>
          <input matInput [(ngModel)]="localData.youtube_content_id" />
        </mat-form-field>
      </p>
      <p>
        <mat-form-field appearance="outline">
          <mat-label>File Hash</mat-label>
          <input matInput [(ngModel)]="localData.file_hash" />
        </mat-form-field>
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="onSave()">Save</button>
    </mat-dialog-actions>
  `,
})
export class EditVideoDialogComponent {
  readonly dialogRef = inject(MatDialogRef<EditVideoDialogComponent>);

  // Receive the passed VideoRecord safely
  readonly data = inject<VideoRecord>(MAT_DIALOG_DATA);

  // Clone data so you don't mutate the source table directly before saving
  localData: VideoRecord = { ...this.data };

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    // Send updated data back to the parent component via close()
    this.dialogRef.close(this.localData);
  }
}
