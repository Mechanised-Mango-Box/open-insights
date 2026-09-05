import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { VideoDatabaseService } from './video-database.service';
import { MatDialog } from '@angular/material/dialog';
import { SceneStats, Transcript, TranscriptStats, readyData } from './Dataset';
import { EditVideoDialogComponent } from './edit-video-dialog.component';
import { MergeVideosDialogComponent } from './merge-videos-dialog.component';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { calculateSha256, VideoRecord } from './VideoRecord';
import { SelectionService } from './selection.service';
import { DatasetActionsService } from './dataset-actions.service';
import {
  DatasetPeekResult,
  STATUS_ICON_STYLES,
  StatusIcon,
  datasetPeekStatusIcon,
  serverStatusIcon,
  datasetStateIcon,
} from './dataset-status';

@Component({
  selector: 'video-table',
  standalone: true,
  imports: [
    CommonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIcon,
  ],
  templateUrl: './video-table.component.html',
  styles: [STATUS_ICON_STYLES],
})
export class VideoTableComponent {
  private dialog = inject(MatDialog);
  videoDatabaseService = inject(VideoDatabaseService);
  private selectionService = inject(SelectionService);
  private datasetActions = inject(DatasetActionsService);
  dataSource = new MatTableDataSource<VideoRecord>([]);

  get selection() {
    return this.selectionService.selection;
  }

  get selectedCount() {
    return this.selectionService.selectedCount();
  }

  get isSelectionEmpty() {
    return this.selectionService.isEmpty();
  }

  bulkActionPending = signal(false);

  // Status/in-flight state lives in DatasetActionsService so the rows reflect actions started
  // from anywhere else too (the Scan tab's bulk buttons, the edit dialog).
  uploadingFile = () => this.datasetActions.uploadingFile();
  sendingTranscript = () => this.datasetActions.sendingTranscript();
  sendingSceneStats = () => this.datasetActions.sendingSceneStats();

  checkTranscriptStatus = (hash: string) => this.datasetActions.checkTranscriptStatus(hash);
  checkSceneStatsStatus = (hash: string) => this.datasetActions.checkSceneStatsStatus(hash);

  constructor() {
    effect(() => {
      const records = this.videoDatabaseService.videoRecords();
      this.dataSource.data = records;
      // Drop any selected rows that no longer exist (e.g. after a delete).
      const stillPresent = this.selection.selected.filter((record) => records.includes(record));
      this.selection.clear();
      if (stillPresent.length > 0) this.selection.select(...stillPresent);

      // Hand the on-screen hashes to DatasetActionsService, which owns keeping their badges
      // fresh. It reads no signals, so this effect stays subscribed to videoRecords() alone -
      // checking the status maps here instead would re-run it once per status write, and
      // re-walk every record each time.
      this.datasetActions.trackHashes(
        records.map((record) => record.video_file.hash).filter((hash) => !!hash),
      );
    });
  }

  getServerStatusIcon(record: VideoRecord): StatusIcon | null {
    if (!record.video_file.hash) return null;
    const status =
      this.datasetActions.serverStatusByHash().get(record.video_file.hash) ?? 'checking';
    return serverStatusIcon(status, {
      hasLocalFile: !!record.video_file.file,
      uploading: this.uploadingFile().has(record.video_file.hash),
    });
  }

  // Picks a local video file for a row directly from the table (no need to open the
  // edit dialog): computes its hash and attaches it, ready for uploadFileToServer.
  onFileSelected = (record: VideoRecord, event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    record.video_file.file = file;
    calculateSha256(file).then((hash) => {
      record.video_file.hash = hash;
      this.videoDatabaseService.updateVideo(record);
    });

    input.value = '';
  };

  // The file-hash column's button doubles as an upload trigger: if a local file is
  // attached and the server doesn't have it yet, clicking sends it; otherwise this
  // just re-checks status (same as before this row had upload capability).
  async uploadFileToServer(record: VideoRecord): Promise<void> {
    try {
      if ((await this.datasetActions.uploadFile(record)) === 'uploaded') {
        await this.videoDatabaseService.updateVideo(record);
      }
    } catch (error) {
      console.error('Failed to upload video:', error);
    }
  }

  private getDatasetStatusIcon(
    record: VideoRecord,
    statusMap: Map<string, DatasetPeekResult>,
  ): StatusIcon | null {
    if (!record.video_file.hash) return null;
    const result = statusMap.get(record.video_file.hash) ?? { status: 'checking' };
    return datasetPeekStatusIcon(result);
  }

  // The template used to test these fields for truthiness to mean "has data".
  // DatasetState is always truthy - 'absent' is a value, not a null - so the
  // question has to be asked explicitly now.
  transcriptData(record: VideoRecord): Transcript | null {
    return readyData(record.ds_transcript);
  }

  transcriptStatsData(record: VideoRecord): TranscriptStats | null {
    return readyData(record.ds_transcriptStats);
  }

  sceneStatsData(record: VideoRecord): SceneStats | null {
    return readyData(record.ds_sceneStats);
  }

  getTranscriptStatusIcon(record: VideoRecord): StatusIcon | null {
    return this.getDatasetStatusIcon(record, this.datasetActions.transcriptStatusByHash());
  }

  getSceneStatsStatusIcon(record: VideoRecord): StatusIcon | null {
    return this.getDatasetStatusIcon(record, this.datasetActions.sceneStatsStatusByHash());
  }

  getTranscriptUploadIcon(record: VideoRecord): StatusIcon | null {
    return datasetStateIcon(
      record.ds_transcript,
      this.sendingTranscript().has(record.video_file.hash),
    );
  }

  getSceneStatsUploadIcon(record: VideoRecord): StatusIcon | null {
    return datasetStateIcon(
      record.ds_sceneStats,
      this.sendingSceneStats().has(record.video_file.hash),
    );
  }

  async sendTranscriptToServer(record: VideoRecord): Promise<void> {
    try {
      await this.datasetActions.fetchTranscript(record);
    } catch (error) {
      console.error('Failed to send transcript to server:', error);
    } finally {
      // Persists either outcome - on failure the record carries a 'failed' upload state.
      await this.videoDatabaseService.updateVideo(record);
    }
  }

  async sendSceneStatsToServer(record: VideoRecord): Promise<void> {
    try {
      await this.datasetActions.fetchSceneStats(record);
    } catch (error) {
      console.error('Failed to send scene stats to server:', error);
    } finally {
      await this.videoDatabaseService.updateVideo(record);
    }
  }

  openEditMenu = (videoRecord: VideoRecord) => {
    const dialogRef = this.dialog.open(EditVideoDialogComponent, {
      data: videoRecord, // Pass the record data to the popup
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        console.log('Updated record data:', result);
        try {
          this.videoDatabaseService.updateVideo(result).then();
          console.log('Video updated successfully!');
        } catch (error) {
          console.error('Failed to update video:', error);
        }
      }
    });
  };
  displayedColumns: string[] = [
    'select',
    'name',
    'file',
    'file-hash',
    'youtube-content-report',
    'youtube-audience-retention',
    'transcript',
    'transcript-stats',
    'scene-stats',
    'actions',
  ];

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  getFileDisplayValue = (element: VideoRecord): string | null =>
    element.video_file.file?.name || element.video_file.hash || null;

  isAllSelected(): boolean {
    return (
      this.dataSource.data.length > 0 &&
      this.selection.selected.length === this.dataSource.data.length
    );
  }

  isSomeSelected(): boolean {
    return this.selection.selected.length > 0 && !this.isAllSelected();
  }

  masterToggle(): void {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.selection.select(...this.dataSource.data);
    }
  }

  async deleteSelected(): Promise<void> {
    const records = this.selection.selected;
    if (records.length === 0) return;
    if (!confirm(`Delete ${records.length} selected record(s)? This cannot be undone.`)) return;

    this.bulkActionPending.set(true);
    try {
      for (const record of records) {
        if (record.__id != null) {
          await this.videoDatabaseService.deleteVideo(record.__id);
        }
      }
      this.selection.clear();
    } finally {
      this.bulkActionPending.set(false);
    }
  }

  mergeSelected(): void {
    const records = this.selection.selected;
    if (records.length < 2) return;

    const dialogRef = this.dialog.open(MergeVideosDialogComponent, { data: records });
    dialogRef.afterClosed().subscribe(async (merged: Omit<VideoRecord, '__id'> | undefined) => {
      if (!merged) return;

      this.bulkActionPending.set(true);
      try {
        await this.videoDatabaseService.addVideo(merged);
        for (const record of records) {
          if (record.__id != null) {
            await this.videoDatabaseService.deleteVideo(record.__id);
          }
        }
        this.selection.clear();
      } finally {
        this.bulkActionPending.set(false);
      }
    });
  }
}
