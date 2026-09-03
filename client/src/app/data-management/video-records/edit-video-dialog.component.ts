import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatDivider } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import {
  computeTranscriptStats,
  formatTimestamp,
  Transcript,
  TranscriptSegment,
  YoutubeAudienceRetention,
  YoutubeContent,
} from './Dataset';
import { calculateSha256, VideoRecord } from './VideoRecord';
import { DatasetServerService } from '../dataset-server.service';
import { parseYoutubeAudienceRetentionCsv, parseYoutubeContentCsv } from './youtube-csv-import';
import { parseTranscriptFile } from './transcript-import';
import {
  DatasetPeekResult,
  ServerStatus,
  STATUS_ICON_STYLES,
  StatusIcon,
  datasetPeekStatusIcon,
  serverStatusIcon,
  uploadStateIcon,
} from './dataset-status';

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
  styles: [STATUS_ICON_STYLES],
})
export class EditVideoDialogComponent {
  readonly dialogRef = inject(MatDialogRef<EditVideoDialogComponent>);
  readonly data = inject<VideoRecord>(MAT_DIALOG_DATA);
  private readonly datasetServerService = inject(DatasetServerService);

  localData: VideoRecord = { ...this.data };

  readonly YoutubeContent = YoutubeContent;
  readonly YoutubeAudienceRetention = YoutubeAudienceRetention;
  readonly formatTimestamp = formatTimestamp;

  uploadPending = signal(false);
  uploadError = signal<string | null>(null);
  transcriptPending = signal(false);
  transcriptError = signal<string | null>(null);
  sceneStatsPending = signal(false);
  sceneStatsError = signal<string | null>(null);

  serverStatus = signal<ServerStatus>('checking');
  transcriptStatus = signal<DatasetPeekResult>({ status: 'checking' });
  sceneStatsStatus = signal<DatasetPeekResult>({ status: 'checking' });

  constructor() {
    const hash = this.localData.video_file.hash;
    if (hash) this.refreshStatuses(hash);
  }

  get videoFileStatusIcon(): StatusIcon {
    return serverStatusIcon(this.serverStatus(), {
      hasLocalFile: !!this.localData.video_file.file,
      uploading: this.uploadPending(),
    });
  }

  get transcriptUploadIcon(): StatusIcon | null {
    return uploadStateIcon(this.localData.ds_transcript, this.transcriptPending());
  }

  get transcriptPeekIcon(): StatusIcon {
    return datasetPeekStatusIcon(this.transcriptStatus());
  }

  get sceneStatsUploadIcon(): StatusIcon | null {
    return uploadStateIcon(this.localData.ds_sceneStats, this.sceneStatsPending());
  }

  get sceneStatsPeekIcon(): StatusIcon {
    return datasetPeekStatusIcon(this.sceneStatsStatus());
  }

  private refreshStatuses(hash: string): void {
    this.checkServerStatus(hash);
    this.checkTranscriptStatus(hash);
    this.checkSceneStatsStatus(hash);
  }

  async checkServerStatus(hash: string): Promise<void> {
    this.serverStatus.set('checking');
    try {
      await this.datasetServerService.getVideoMeta(hash);
      this.serverStatus.set('exists');
    } catch (error) {
      this.serverStatus.set(error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error');
    }
  }

  async checkTranscriptStatus(hash: string): Promise<void> {
    this.transcriptStatus.set({ status: 'checking' });
    try {
      const response = await this.datasetServerService.peekTranscriptStatus(hash);
      this.transcriptStatus.set(
        response.status === 'failed' ? { status: 'failed', error: response.error } : { status: response.status },
      );
    } catch (error) {
      this.transcriptStatus.set(
        error instanceof HttpErrorResponse && error.status === 404 ? { status: 'not_started' } : { status: 'error' },
      );
    }
  }

  async checkSceneStatsStatus(hash: string): Promise<void> {
    this.sceneStatsStatus.set({ status: 'checking' });
    try {
      const response = await this.datasetServerService.peekSceneStatsStatus(hash);
      this.sceneStatsStatus.set(
        response.status === 'failed' ? { status: 'failed', error: response.error } : { status: response.status },
      );
    } catch (error) {
      this.sceneStatsStatus.set(
        error instanceof HttpErrorResponse && error.status === 404 ? { status: 'not_started' } : { status: 'error' },
      );
    }
  }

  onVideoFileSelected = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.localData.video_file.file = file;
      calculateSha256(file).then((hash) => {
        this.localData.video_file.hash = hash;
        this.refreshStatuses(hash);
      });
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
    this.localData.video_file.file = null;
  }

  async uploadToServer(): Promise<void> {
    if (!this.localData.video_file.file) {
      this.uploadError.set('Select the video file first.');
      return;
    }
    this.uploadPending.set(true);
    this.uploadError.set(null);
    try {
      await this.datasetServerService.uploadVideo(this.localData.video_file.file);
      this.localData.video_file.exists_on_server = true;
      await this.checkServerStatus(this.localData.video_file.hash);
    } catch (error) {
      console.error('Upload failed:', error);
      this.uploadError.set('Upload failed. See console for details.');
    } finally {
      this.uploadPending.set(false);
    }
  }

  async computeTranscriptViaServer(options?: { regenerate?: boolean }): Promise<void> {
    if (!this.localData.video_file.file) {
      this.transcriptError.set('Select the video file first.');
      return;
    }
    this.transcriptPending.set(true);
    this.transcriptError.set(null);
    try {
      await this.datasetServerService.uploadVideo(this.localData.video_file.file);
      const { transcript, stats } = await this.datasetServerService.getTranscript(
        this.localData.video_file.hash,
        options,
      );
      this.localData.ds_transcript = { upload_state: { is_local: false }, data: transcript };
      this.localData.ds_transcriptStats = { upload_state: { is_local: false }, data: stats };
    } catch (error) {
      console.error('Transcript computation failed:', error);
      this.transcriptError.set('Transcript computation failed. See console for details.');
    } finally {
      this.transcriptPending.set(false);
    }
  }

  async computeSceneStatsViaServer(): Promise<void> {
    if (!this.localData.video_file.file) {
      this.sceneStatsError.set('Select the video file first.');
      return;
    }
    this.sceneStatsPending.set(true);
    this.sceneStatsError.set(null);
    try {
      await this.datasetServerService.uploadVideo(this.localData.video_file.file);
      const sceneStats = await this.datasetServerService.getSceneStats(this.localData.video_file.hash);
      this.localData.ds_sceneStats = { upload_state: { is_local: false }, data: sceneStats };
    } catch (error) {
      console.error('Scene stats computation failed:', error);
      this.sceneStatsError.set('Scene stats computation failed. See console for details.');
    } finally {
      this.sceneStatsPending.set(false);
    }
  }

  get transcriptSegments(): TranscriptSegment[] {
    return this.localData.ds_transcript?.data.segments ?? [];
  }

  /** A transcript with no segments is the tell-tale of a server row transcribed before
   * segment timing was stored - its text didn't survive the move to timestamped-only
   * transcripts, so the only way to fill it back in is another Whisper run. */
  get canRecomputeWithTimestamps(): boolean {
    return !!this.localData.ds_transcript && this.transcriptSegments.length === 0;
  }

  onTranscriptFileSelected = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    file.text().then((text) => {
      const transcript = parseTranscriptFile(text);
      if (transcript.segments.length === 0) {
        this.transcriptError.set('No subtitle cues found - expected an SRT or VTT file.');
        return;
      }
      this.transcriptError.set(null);
      this.setLocalTranscript(transcript);
    });

    input.value = '';
  };

  clearLocalTranscript(): void {
    this.localData.ds_transcript = null;
    this.localData.ds_transcriptStats = null;
  }

  private setLocalTranscript(transcript: Transcript): void {
    this.localData.ds_transcript = {
      upload_state: { is_local: true, server_side_state: 'ready' },
      data: transcript,
    };
    this.localData.ds_transcriptStats = {
      upload_state: { is_local: true, server_side_state: 'ready' },
      data: computeTranscriptStats(transcript),
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
