import { Component, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatInputModule } from '@angular/material/input';
import { OpfsService, VideoItem } from '../opfs.service';
import { VideoDatabaseService } from './video-database.service';
import { MatDialog } from '@angular/material/dialog';
import { EditVideoDialogComponent } from './edit-video-dialog.component';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'video-table',
  standalone: true,
  imports: [CommonModule, MatFormFieldModule, MatInputModule, MatTableModule, MatButtonModule],
  templateUrl: './video-table.component.html',
})
export class VideoTableComponent {
  // opfsService = inject(OpfsService);
  private dialog = inject(MatDialog);
  videoDatabaseService = inject(VideoDatabaseService);
  // activeVideo: VideoItem | null = null;
  dataSource = new MatTableDataSource<VideoRecord>([]);

  constructor() {
    effect(() => {
      const records = this.videoDatabaseService.videoRecords();
      this.dataSource.data = records;
    });
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

  // async deleteVideo(name: string) {
  //   if (confirm(`Are you sure you want to delete ${name} from OPFS?`)) {
  //     if (this.activeVideo?.name === name) {
  //       this.activeVideo = null;
  //     }
  //     await this.opfsService.deleteVideo(name);
  //   }
  // }
  // getSceneStats(names: string[]) {
  //   startSceneWW(names);
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
    'name',
    'youtube-content-id',
    'file',
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
}

const startSceneWW = (names: string[]) => {
  console.log(`Starting WebWorker for ${names.length} items.`);
};
