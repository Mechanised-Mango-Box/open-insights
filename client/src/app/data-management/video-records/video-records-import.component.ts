import { Component, inject, signal } from '@angular/core';
import { VideoDatabaseService } from './video-db.service';

@Component({
  selector: 'video-records-import',
  template: `
    <button (click)="insertNewEmpty()">Create Empty</button>
    <button (click)="insertFromYoutubeContent()">Import From: Youtube Content</button>
  `,
})
export class VideoRecordsImport {
  private dbService = inject(VideoDatabaseService);

  records = signal<VideoRecord[]>([]);

  async insertNewEmpty() {
    const sampleRecord: VideoRecord = {
      sort_name: 'New Record',
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
