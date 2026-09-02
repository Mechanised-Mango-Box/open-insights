import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { OpfsService, VideoItem } from '../opfs.service';
import { VideoDatabaseService } from './video-database.service';
import { MatDialog } from '@angular/material/dialog';
import { EditVideoDialogComponent } from './edit-video-dialog.component';
import { MergeVideosDialogComponent } from './merge-videos-dialog.component';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { calculateSha256, VideoRecord } from './VideoRecord';
import { buildExportZip, downloadBlob } from './manifest-export';
import { SelectionService } from './selection.service';
import { DatasetServerService } from '../dataset-server.service';
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
  // opfsService = inject(OpfsService);
  private dialog = inject(MatDialog);
  videoDatabaseService = inject(VideoDatabaseService);
  private selectionService = inject(SelectionService);
  private datasetServerService = inject(DatasetServerService);
  // activeVideo: VideoItem | null = null;
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
  serverStatusByHash = signal<Map<string, ServerStatus>>(new Map());
  transcriptStatusByHash = signal<Map<string, DatasetPeekResult>>(new Map());
  sceneStatsStatusByHash = signal<Map<string, DatasetPeekResult>>(new Map());
  sendingTranscript = signal<Set<string>>(new Set());
  sendingSceneStats = signal<Set<string>>(new Set());
  uploadingFile = signal<Set<string>>(new Set());

  constructor() {
    effect(() => {
      const records = this.videoDatabaseService.videoRecords();
      this.dataSource.data = records;
      // Drop any selected rows that no longer exist (e.g. after a delete).
      const stillPresent = this.selection.selected.filter((record) => records.includes(record));
      this.selection.clear();
      if (stillPresent.length > 0) this.selection.select(...stillPresent);

      for (const record of records) {
        const hash = record.video_file.hash;
        if (!hash) continue;
        if (!this.serverStatusByHash().has(hash)) {
          this.checkServerStatus(hash);
        }
        if (!this.transcriptStatusByHash().has(hash)) {
          this.checkTranscriptStatus(hash);
        }
        if (!this.sceneStatsStatusByHash().has(hash)) {
          this.checkSceneStatsStatus(hash);
        }
      }
    });
  }

  async checkServerStatus(hash: string): Promise<void> {
    this.serverStatusByHash.update((map) => new Map(map).set(hash, 'checking'));
    let status: ServerStatus;
    try {
      await this.datasetServerService.getVideoMeta(hash);
      status = 'exists';
    } catch (error) {
      status = error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error';
    }
    this.serverStatusByHash.update((map) => new Map(map).set(hash, status));
  }

  getServerStatusIcon(record: VideoRecord): StatusIcon | null {
    if (!record.video_file.hash) return null;
    const status = this.serverStatusByHash().get(record.video_file.hash) ?? 'checking';
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
    const hash = record.video_file.hash;
    if (!hash) return;
    if (!record.video_file.file) {
      await this.checkServerStatus(hash);
      return;
    }

    this.uploadingFile.update((set) => new Set(set).add(hash));
    try {
      await this.datasetServerService.uploadVideo(record.video_file.file);
      record.video_file.exists_on_server = true;
      await this.videoDatabaseService.updateVideo(record);
    } catch (error) {
      console.error('Failed to upload video:', error);
    } finally {
      this.uploadingFile.update((set) => {
        const next = new Set(set);
        next.delete(hash);
        return next;
      });
    }
    await this.checkServerStatus(hash);
  }

  async checkTranscriptStatus(hash: string): Promise<void> {
    this.transcriptStatusByHash.update((map) => new Map(map).set(hash, { status: 'checking' }));
    let result: DatasetPeekResult;
    try {
      const response = await this.datasetServerService.peekTranscriptStatus(hash);
      result =
        response.status === 'failed'
          ? { status: 'failed', error: response.error }
          : { status: response.status };
    } catch (error) {
      result = error instanceof HttpErrorResponse && error.status === 404
        ? { status: 'not_started' }
        : { status: 'error' };
    }
    this.transcriptStatusByHash.update((map) => new Map(map).set(hash, result));
  }

  async checkSceneStatsStatus(hash: string): Promise<void> {
    this.sceneStatsStatusByHash.update((map) => new Map(map).set(hash, { status: 'checking' }));
    let result: DatasetPeekResult;
    try {
      const response = await this.datasetServerService.peekSceneStatsStatus(hash);
      result =
        response.status === 'failed'
          ? { status: 'failed', error: response.error }
          : { status: response.status };
    } catch (error) {
      result = error instanceof HttpErrorResponse && error.status === 404
        ? { status: 'not_started' }
        : { status: 'error' };
    }
    this.sceneStatsStatusByHash.update((map) => new Map(map).set(hash, result));
  }

  private getDatasetStatusIcon(
    record: VideoRecord,
    statusMap: Map<string, DatasetPeekResult>,
  ): StatusIcon | null {
    if (!record.video_file.hash) return null;
    const result = statusMap.get(record.video_file.hash) ?? { status: 'checking' };
    return datasetPeekStatusIcon(result);
  }

  getTranscriptStatusIcon(record: VideoRecord): StatusIcon | null {
    return this.getDatasetStatusIcon(record, this.transcriptStatusByHash());
  }

  getSceneStatsStatusIcon(record: VideoRecord): StatusIcon | null {
    return this.getDatasetStatusIcon(record, this.sceneStatsStatusByHash());
  }

  getTranscriptUploadIcon(record: VideoRecord): StatusIcon | null {
    return uploadStateIcon(record.ds_transcript, this.sendingTranscript().has(record.video_file.hash));
  }

  getSceneStatsUploadIcon(record: VideoRecord): StatusIcon | null {
    return uploadStateIcon(record.ds_sceneStats, this.sendingSceneStats().has(record.video_file.hash));
  }

  // Re-runs server generation for this row's transcript (uploading the video first if
  // it hasn't been already), overwriting local data with the server's result - this is
  // "send to server" in the sense of reconciling with the server, not pushing local
  // edits verbatim (the dataset-server API has no endpoint to accept those).
  async sendTranscriptToServer(record: VideoRecord): Promise<void> {
    const hash = record.video_file.hash;
    if (!hash) return;
    this.sendingTranscript.update((set) => new Set(set).add(hash));
    try {
      if (record.video_file.file) {
        await this.datasetServerService.uploadVideo(record.video_file.file);
      }
      const { transcript, stats } = await this.datasetServerService.getTranscript(hash);
      record.ds_transcript = { upload_state: { is_local: false }, data: transcript };
      record.ds_transcriptStats = { upload_state: { is_local: false }, data: stats };
    } catch (error) {
      console.error('Failed to send transcript to server:', error);
      if (record.ds_transcript) {
        record.ds_transcript = {
          ...record.ds_transcript,
          upload_state: { is_local: true, server_side_state: 'failed' },
        };
      }
    } finally {
      this.sendingTranscript.update((set) => {
        const next = new Set(set);
        next.delete(hash);
        return next;
      });
    }
    await this.videoDatabaseService.updateVideo(record);
  }

  async sendSceneStatsToServer(record: VideoRecord): Promise<void> {
    const hash = record.video_file.hash;
    if (!hash) return;
    this.sendingSceneStats.update((set) => new Set(set).add(hash));
    try {
      if (record.video_file.file) {
        await this.datasetServerService.uploadVideo(record.video_file.file);
      }
      const sceneStats = await this.datasetServerService.getSceneStats(hash);
      record.ds_sceneStats = { upload_state: { is_local: false }, data: sceneStats };
    } catch (error) {
      console.error('Failed to send scene stats to server:', error);
      if (record.ds_sceneStats) {
        record.ds_sceneStats = {
          ...record.ds_sceneStats,
          upload_state: { is_local: true, server_side_state: 'failed' },
        };
      }
    } finally {
      this.sendingSceneStats.update((set) => {
        const next = new Set(set);
        next.delete(hash);
        return next;
      });
    }
    await this.videoDatabaseService.updateVideo(record);
  }

  // async onFilesSelected(event: any) {
  //   const files: FileList = event.target.files;
  //   if (files && files.length > 0) {
  //     await this.opfsService.uploadVideos(files);
  //     event.target.value = ''; // Reset input so selecting the same files again triggers change
  //   }
  // }

  // playVideo(video: VideoItem) {
  //   this.activeVideo = video;
  // }

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

  async exportSelected(): Promise<void> {
    const records = this.selection.selected;
    if (records.length === 0) return;

    this.bulkActionPending.set(true);
    try {
      const blob = await buildExportZip(records);
      downloadBlob(blob, `open-insights-export-selected-${new Date().toISOString()}.zip`);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed - see console for details.');
    } finally {
      this.bulkActionPending.set(false);
    }
  }

  mergeSelected(): void {
    const records = this.selection.selected;
    if (records.length < 2) return;

    const dialogRef = this.dialog.open(MergeVideosDialogComponent, { data: records });
    dialogRef.afterClosed().subscribe(async (merged: Omit<VideoRecord, 'id'> | undefined) => {
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
