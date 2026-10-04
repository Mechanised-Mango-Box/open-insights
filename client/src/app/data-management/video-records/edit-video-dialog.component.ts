import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatDivider } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import {
  AudioStats,
  LOCAL_IMPORT,
  SceneStats,
  TextStats,
  TranscriptStats,
  computeTranscriptStats,
  isReady,
  readyData,
  formatTimestamp,
  Transcript,
  TranscriptSegment,
  YoutubeAudienceRetention,
  YoutubeContent,
} from './Dataset';
import { calculateSha256, VideoRecord } from './VideoRecord';
import { DatasetActionsService } from './dataset-actions.service';
import { parseYoutubeAudienceRetentionCsv, parseYoutubeContentCsv } from './youtube-csv-import';
import { readFileDurationSecs, recordDurationSecs } from './video-duration';
import { isAcceptedVideoName, notAcceptedMessage, VIDEO_FILE_ACCEPT } from './video-file-types';
import { parseTranscriptFile } from './transcript-import';
import {
  STATUS_ICON_STYLES,
  StatusIcon,
  datasetPeekStatusIcon,
  serverStatusIcon,
  datasetStateIcon,
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
  private readonly datasetActions = inject(DatasetActionsService);

  localData: VideoRecord = { ...this.data };

  readonly YoutubeContent = YoutubeContent;
  readonly YoutubeAudienceRetention = YoutubeAudienceRetention;
  readonly formatTimestamp = formatTimestamp;
  readonly videoFileAccept = VIDEO_FILE_ACCEPT;

  uploadError = signal<string | null>(null);
  transcriptError = signal<string | null>(null);
  sceneStatsError = signal<string | null>(null);
  textStatsError = signal<string | null>(null);
  audioStatsError = signal<string | null>(null);

  // Pending state and server statuses live in DatasetActionsService, keyed by file hash, so the
  // dialog and the table row behind it always agree about what's in flight.
  uploadPending = () => this.datasetActions.uploadingFile().has(this.localData.video_file.hash);
  transcriptPending = () =>
    this.datasetActions.sendingTranscript().has(this.localData.video_file.hash);
  sceneStatsPending = () =>
    this.datasetActions.sendingSceneStats().has(this.localData.video_file.hash);
  textStatsPending = () =>
    this.datasetActions.sendingTextStats().has(this.localData.video_file.hash);
  audioStatsPending = () =>
    this.datasetActions.sendingAudioStats().has(this.localData.video_file.hash);

  checkServerStatus = (hash: string) => this.datasetActions.checkServerStatus(hash);
  checkTranscriptStatus = (hash: string) => this.datasetActions.checkTranscriptStatus(hash);
  checkSceneStatsStatus = (hash: string) => this.datasetActions.checkSceneStatsStatus(hash);
  checkTextStatsStatus = (hash: string) => this.datasetActions.checkTextStatsStatus(hash);
  checkAudioStatsStatus = (hash: string) => this.datasetActions.checkAudioStatsStatus(hash);

  constructor() {
    const hash = this.localData.video_file.hash;
    if (hash) this.refreshStatuses(hash);
  }

  get videoFileStatusIcon(): StatusIcon {
    const status =
      this.datasetActions.serverStatusByHash().get(this.localData.video_file.hash) ?? 'checking';
    return serverStatusIcon(status, {
      hasLocalFile: !!this.localData.video_file.file,
      uploading: this.uploadPending(),
      where: this.datasetActions.providerLabel(),
    });
  }

  get transcriptUploadIcon(): StatusIcon | null {
    return datasetStateIcon(
      this.localData.ds_transcript,
      this.transcriptPending(),
      this.datasetActions.providerLabel(),
    );
  }

  get transcriptPeekIcon(): StatusIcon {
    return datasetPeekStatusIcon(
      this.datasetActions.transcriptStatusByHash().get(this.localData.video_file.hash) ?? {
        status: 'checking',
      },
      this.datasetActions.providerLabel(),
    );
  }

  get sceneStatsUploadIcon(): StatusIcon | null {
    return datasetStateIcon(
      this.localData.ds_sceneStats,
      this.sceneStatsPending(),
      this.datasetActions.providerLabel(),
    );
  }

  get sceneStatsPeekIcon(): StatusIcon {
    return datasetPeekStatusIcon(
      this.datasetActions.sceneStatsStatusByHash().get(this.localData.video_file.hash) ?? {
        status: 'checking',
      },
      this.datasetActions.providerLabel(),
    );
  }

  get textStatsUploadIcon(): StatusIcon | null {
    return datasetStateIcon(
      this.localData.ds_textStats,
      this.textStatsPending(),
      this.datasetActions.providerLabel(),
    );
  }

  get textStatsPeekIcon(): StatusIcon {
    return datasetPeekStatusIcon(
      this.datasetActions.textStatsStatusByHash().get(this.localData.video_file.hash) ?? {
        status: 'checking',
      },
      this.datasetActions.providerLabel(),
    );
  }

  get audioStatsUploadIcon(): StatusIcon | null {
    return datasetStateIcon(
      this.localData.ds_audioStats,
      this.audioStatsPending(),
      this.datasetActions.providerLabel(),
    );
  }

  get audioStatsPeekIcon(): StatusIcon {
    return datasetPeekStatusIcon(
      this.datasetActions.audioStatsStatusByHash().get(this.localData.video_file.hash) ?? {
        status: 'checking',
      },
      this.datasetActions.providerLabel(),
    );
  }

  private refreshStatuses(hash: string): void {
    this.checkServerStatus(hash);
    this.checkTranscriptStatus(hash);
    this.checkSceneStatsStatus(hash);
    this.checkTextStatsStatus(hash);
    this.checkAudioStatsStatus(hash);
  }

  onVideoFileSelected = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      // `accept` is only the picker's default filter; "All files" gets past it.
      if (!isAcceptedVideoName(file.name)) {
        this.uploadError.set(notAcceptedMessage(file.name));
        input.value = '';
        return;
      }
      this.uploadError.set(null);
      this.localData.video_file.file = file;
      readFileDurationSecs(file).then((duration) => {
        this.localData.video_file.duration_secs = duration;
      });
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
    // Cleared with the file it describes - a duration outliving its file would
    // keep feeding the table's Duration column with no way to re-derive it.
    this.localData.video_file.duration_secs = null;
  }

  // The dataset actions below mutate `localData` only - the dialog still persists nothing until
  // Save, which hands the record back for the table to write.
  async uploadToServer(): Promise<void> {
    this.uploadError.set(null);
    try {
      if ((await this.datasetActions.uploadFile(this.localData)) === 'no-local-file') {
        this.uploadError.set('Select the video file first.');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      // The server's reason when it refused the file ("holds no video", ...); the
      // console for anything else.
      this.uploadError.set(
        error instanceof Error ? error.message : 'Upload failed. See console for details.',
      );
    }
  }

  async computeTranscriptViaServer(): Promise<void> {
    this.transcriptError.set(null);
    if (!this.localData.video_file.hash) {
      this.transcriptError.set('Select the video file first.');
      return;
    }
    try {
      await this.datasetActions.fetchTranscript(this.localData);
    } catch (error) {
      console.error('Transcript computation failed:', error);
      this.transcriptError.set('Transcript computation failed. See console for details.');
    }
  }

  async computeSceneStatsViaServer(): Promise<void> {
    this.sceneStatsError.set(null);
    if (!this.localData.video_file.hash) {
      this.sceneStatsError.set('Select the video file first.');
      return;
    }
    try {
      await this.datasetActions.fetchSceneStats(this.localData);
    } catch (error) {
      console.error('Scene stats computation failed:', error);
      this.sceneStatsError.set('Scene stats computation failed. See console for details.');
    }
  }

  async computeTextStatsViaServer(): Promise<void> {
    this.textStatsError.set(null);
    if (!this.localData.video_file.hash) {
      this.textStatsError.set('Select the video file first.');
      return;
    }
    try {
      await this.datasetActions.fetchTextStats(this.localData);
    } catch (error) {
      console.error('Screen text computation failed:', error);
      this.textStatsError.set('Screen text computation failed. See console for details.');
    }
  }

  async computeAudioStatsViaServer(): Promise<void> {
    this.audioStatsError.set(null);
    if (!this.localData.video_file.hash) {
      this.audioStatsError.set('Select the video file first.');
      return;
    }
    try {
      await this.datasetActions.fetchAudioStats(this.localData);
    } catch (error) {
      console.error('Audio stats computation failed:', error);
      this.audioStatsError.set('Audio stats computation failed. See console for details.');
    }
  }

  get hasLocalTranscript(): boolean {
    return isReady(this.localData.ds_transcript);
  }

  get transcriptStatsData(): TranscriptStats | null {
    return readyData(this.localData.ds_transcriptStats);
  }

  get sceneStatsData(): SceneStats | null {
    return readyData(this.localData.ds_sceneStats);
  }

  clearLocalSceneStats(): void {
    this.localData.ds_sceneStats = { state: 'absent' };
  }

  get textStatsData(): TextStats | null {
    return readyData(this.localData.ds_textStats);
  }

  clearLocalTextStats(): void {
    this.localData.ds_textStats = { state: 'absent' };
  }

  get audioStatsData(): AudioStats | null {
    return readyData(this.localData.ds_audioStats);
  }

  clearLocalAudioStats(): void {
    this.localData.ds_audioStats = { state: 'absent' };
  }

  get transcriptSegments(): TranscriptSegment[] {
    return readyData(this.localData.ds_transcript)?.segments ?? [];
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
    this.localData.ds_transcript = { state: 'absent' };
    this.localData.ds_transcriptStats = { state: 'absent' };
  }

  private setLocalTranscript(transcript: Transcript): void {
    // producer records that this came from a file the user supplied, not a
    // server run - the question the old is_local flag was gesturing at.
    this.localData.ds_transcript = {
      state: 'ready',
      data: transcript,
      producer: LOCAL_IMPORT,
    };
    this.localData.ds_transcriptStats = {
      state: 'ready',
      data: computeTranscriptStats(transcript, recordDurationSecs(this.localData)),
      producer: LOCAL_IMPORT,
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
