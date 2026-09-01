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
import { VideoRecord } from './VideoRecord';
import { buildExportCsv, downloadCsv } from './csv-export';
import { SelectionService } from './selection.service';
import { DatasetServerService } from '../dataset-server.service';

type ServerStatus = 'checking' | 'exists' | 'missing' | 'error';

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
  styles: [
    `
      .server-status.status-exists {
        color: #2e7d32;
      }
      .server-status.status-missing {
        color: #9e9e9e;
      }
      .server-status.status-error {
        color: #c62828;
      }
      .server-status.status-checking {
        color: #9e9e9e;
      }
    `,
  ],
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

  constructor() {
    effect(() => {
      const records = this.videoDatabaseService.videoRecords();
      this.dataSource.data = records;
      // Drop any selected rows that no longer exist (e.g. after a delete).
      const stillPresent = this.selection.selected.filter((record) => records.includes(record));
      this.selection.clear();
      if (stillPresent.length > 0) this.selection.select(...stillPresent);

      for (const record of records) {
        if (record.file_hash && !this.serverStatusByHash().has(record.file_hash)) {
          this.checkServerStatus(record.file_hash);
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

  getServerStatusIcon(record: VideoRecord): { icon: string; label: string; cssClass: string } | null {
    if (!record.file_hash) return null;
    const status = this.serverStatusByHash().get(record.file_hash) ?? 'checking';
    switch (status) {
      case 'checking':
        return { icon: 'hourglass_empty', label: 'Checking server...', cssClass: 'status-checking' };
      case 'exists':
        return { icon: 'cloud_done', label: 'Video exists on server', cssClass: 'status-exists' };
      case 'missing':
        return { icon: 'cloud_off', label: 'Video not on server', cssClass: 'status-missing' };
      case 'error':
        return { icon: 'error_outline', label: 'Could not reach server', cssClass: 'status-error' };
    }
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
    'scene-stats',
    'actions',
  ];

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  getFileDisplayValue = (element: VideoRecord): string | null =>
    element.file_handle?.name || element.file_hash || null;

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
        if (record.id != null) {
          await this.videoDatabaseService.deleteVideo(record.id);
        }
      }
      this.selection.clear();
    } finally {
      this.bulkActionPending.set(false);
    }
  }

  exportSelected(): void {
    const records = this.selection.selected;
    if (records.length === 0) return;
    const csv = buildExportCsv(records);
    downloadCsv(csv, `open-insights-export-selected-${new Date().toISOString()}.csv`);
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
          if (record.id != null) {
            await this.videoDatabaseService.deleteVideo(record.id);
          }
        }
        this.selection.clear();
      } finally {
        this.bulkActionPending.set(false);
      }
    });
  }
}
