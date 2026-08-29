import { Component, inject, signal } from '@angular/core';
import { VideoDatabaseService } from './video-database.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
@Component({
  selector: 'video-records-import',
  template: `
    <div class="import-actions">
      <button mat-raised-button color="primary" (click)="insertNewEmpty()">
        <mat-icon>add</mat-icon>
        Create Empty
      </button>
      <button mat-raised-button color="accent" (click)="insertFromYoutubeContent()">
        <mat-icon>add</mat-icon>
        Import From: Youtube Content
      </button>
    </div>
  `,
  imports: [MatIcon, MatButtonModule],
})
export class VideoRecordsImport {
  private dbService = inject(VideoDatabaseService);

  records = signal<VideoRecord[]>([]);

  async insertNewEmpty() {
    const sampleRecord: VideoRecord = {
      sort_name: 'Untitled New Record',
    };

    try {
      await this.dbService.addVideo(sampleRecord);
      console.log('VideoRecord saved successfully!');
    } catch (error) {
      console.error('Failed to save record:', error);
    }
  }

  async insertFromYoutubeContent() {}

  // async loadRecords() {
  //   const data = await this.dbService.getAllVideos();
  //   this.records.set(data);
  // }
}
