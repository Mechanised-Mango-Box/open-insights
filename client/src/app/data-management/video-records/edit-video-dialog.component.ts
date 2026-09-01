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
import {
  createEmptyTranscript,
  createEmptyYoutubeAudienceRetention,
  createEmptyYoutubeContent,
  Transcript,
} from './Dataset';
import { calculateSha256, VideoRecord } from './VideoRecord';
import { DatasetServerService } from '../dataset-server.service';
import { parseYoutubeAudienceRetentionCsv, parseYoutubeContentCsv } from './youtube-csv-import';

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
  private readonly datasetServerService = inject(DatasetServerService);

  localData: VideoRecord = { ...this.data };
  //   selectedFileName: string = '';
  //   selectedFile: File | null = null;

  createEmptyYoutubeContent = createEmptyYoutubeContent;
  createEmptyTranscript = createEmptyTranscript;
  createEmptyYoutubeAudienceRetention = createEmptyYoutubeAudienceRetention;

  uploadPending = signal(false);
  uploadError = signal<string | null>(null);
  transcriptPending = signal(false);
  transcriptError = signal<string | null>(null);
  sceneStatsPending = signal(false);
  sceneStatsError = signal<string | null>(null);

  onVideoFileSelected = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.localData.file_handle = input.files[0];
      calculateSha256(this.localData.file_handle).then((res) => (this.localData.file_hash = res));
    }
  };

  onYoutubeContentReport = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    file.text().then((text) => {
      const rows = parseYoutubeContentCsv(text);
      if (rows.length > 0) {
        this.localData.ds_youtubeContent = rows[0].content;
      }
    });

    input.value = '';
  };

  onYoutubeAudienceRetention = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    file.text().then((text) => {
      this.localData.ds_youtubeAudienceRetention = parseYoutubeAudienceRetentionCsv(text);
    });

    input.value = '';
  };

  clearFile(): void {
    // this.selectedFile = null;
    // this.selectedFileName = '';
    this.localData.file_handle = undefined;
  }

  async uploadToServer(): Promise<void> {
    if (!this.localData.file_handle) {
      this.uploadError.set('Select the video file first.');
      return;
    }
    this.uploadPending.set(true);
    this.uploadError.set(null);
    try {
      await this.datasetServerService.uploadVideo(this.localData.file_handle);
    } catch (error) {
      console.error('Upload failed:', error);
      this.uploadError.set('Upload failed. See console for details.');
    } finally {
      this.uploadPending.set(false);
    }
  }

  async computeTranscriptViaServer(): Promise<void> {
    if (!this.localData.file_handle) {
      this.transcriptError.set('Select the video file first.');
      return;
    }
    this.transcriptPending.set(true);
    this.transcriptError.set(null);
    try {
      await this.datasetServerService.uploadVideo(this.localData.file_handle);
      this.localData.ds_transcript = await this.datasetServerService.getTranscript(
        this.localData.file_hash!,
      );
    } catch (error) {
      console.error('Transcript computation failed:', error);
      this.transcriptError.set('Transcript computation failed. See console for details.');
    } finally {
      this.transcriptPending.set(false);
    }
  }

  async computeSceneStatsViaServer(): Promise<void> {
    if (!this.localData.file_handle) {
      this.sceneStatsError.set('Select the video file first.');
      return;
    }
    this.sceneStatsPending.set(true);
    this.sceneStatsError.set(null);
    try {
      await this.datasetServerService.uploadVideo(this.localData.file_handle);
      this.localData.ds_sceneStats = await this.datasetServerService.getSceneStats(
        this.localData.file_hash!,
      );
    } catch (error) {
      console.error('Scene stats computation failed:', error);
      this.sceneStatsError.set('Scene stats computation failed. See console for details.');
    } finally {
      this.sceneStatsPending.set(false);
    }
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
