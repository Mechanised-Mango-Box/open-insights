import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatDividerModule, MatDivider } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { createEmptyTranscript, createEmptyYoutubeContent, Transcript } from './Dataset';
import { calculateSha256, VideoRecord } from './VideoRecord';

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
    MatExpansionModule,
  ],
  templateUrl: './edit-video-dialog.component.html',
})
export class EditVideoDialogComponent {
  readonly dialogRef = inject(MatDialogRef<EditVideoDialogComponent>);
  readonly data = inject<VideoRecord>(MAT_DIALOG_DATA);

  localData: VideoRecord = { ...this.data };
  //   selectedFileName: string = '';
  //   selectedFile: File | null = null;

  createEmptyYoutubeContent = createEmptyYoutubeContent;
  createEmptyTranscript = createEmptyTranscript;

  onVideoFileSelected = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.localData.file_handle = input.files[0];
      calculateSha256(this.localData.file_handle).then((res) => (this.localData.file_hash = res));
    }
  };

  onYoutubeContentReport = (event: Event): void => {};
  onYoutubeAudienceRetention = (event: Event): void => {};
  clearFile(): void {
    // this.selectedFile = null;
    // this.selectedFileName = '';
    this.localData.file_handle = undefined;
  }

  onTranscriptFileSelected = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    file.text().then((text) => {
      this.localData.ds_transcript = this.buildTranscript(text);
    });

    input.value = '';
  };

  onTranscriptTextChanged = (text: string): void => {
    this.localData.ds_transcript = this.buildTranscript(text);
  };

  private buildTranscript(text: string): Transcript {
    const words = text.trim().length ? text.trim().split(/\s+/) : [];
    return {
      text,
      count_chars: text.length,
      count_words: words.length,
    };
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
