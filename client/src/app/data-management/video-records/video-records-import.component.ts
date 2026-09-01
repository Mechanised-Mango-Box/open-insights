import { Component, inject, signal } from '@angular/core';
import { VideoDatabaseService } from './video-database.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { parseYoutubeContentCsv } from './youtube-csv-import';
import { calculateSha256, VideoRecord } from './VideoRecord';

@Component({
  selector: 'video-records-import',
  template: `
    <div class="import-actions">
      <button mat-raised-button color="primary" (click)="insertNewEmpty()">
        <mat-icon>add</mat-icon>
        Create Empty
      </button>
      <button mat-raised-button color="accent" (click)="csvInput.click()">
        <mat-icon>add</mat-icon>
        Import From: Youtube Content
      </button>
      <input
        type="file"
        #csvInput
        style="display: none"
        accept=".csv"
        (change)="insertFromYoutubeContent($event)"
      />
      <button mat-raised-button color="accent" (click)="videoInput.click()">
        <mat-icon>add</mat-icon>
        Create From: Video Files
      </button>
      <input
        type="file"
        #videoInput
        style="display: none"
        accept="video/*"
        multiple
        (change)="insertFromVideoFiles($event)"
      />
      @if (importSummary()) {
      <span class="import-summary">{{ importSummary() }}</span>
      }
    </div>
  `,
  imports: [MatIcon, MatButtonModule],
})
export class VideoRecordsImport {
  private dbService = inject(VideoDatabaseService);

  records = signal<VideoRecord[]>([]);
  importSummary = signal<string | null>(null);

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

  async insertFromYoutubeContent(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const csvText = await file.text();
    const rows = parseYoutubeContentCsv(csvText);
    const existing = await this.dbService.getAllVideos();

    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const match = existing.find(
        (record) => record.ds_youtubeContent?.content === row.content.content,
      );
      if (match) {
        await this.dbService.updateVideo({ ...match, ds_youtubeContent: row.content });
        updated++;
      } else {
        await this.dbService.addVideo({ sort_name: row.title, ds_youtubeContent: row.content });
        created++;
      }
    }

    this.importSummary.set(`Imported ${rows.length} row(s): ${created} created, ${updated} updated.`);
    input.value = '';
  }

  async insertFromVideoFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    const existing = await this.dbService.getAllVideos();
    const existingHashes = new Set(existing.map((record) => record.file_hash));

    let created = 0;
    let skipped = 0;
    for (const file of Array.from(files)) {
      const file_hash = await calculateSha256(file);
      if (existingHashes.has(file_hash)) {
        skipped++;
        continue;
      }

      await this.dbService.addVideo({ sort_name: file.name, file_hash, file_handle: file });
      existingHashes.add(file_hash);
      created++;
    }

    this.importSummary.set(
      `Processed ${files.length} file(s): ${created} created, ${skipped} skipped (already exist).`,
    );
    input.value = '';
  }

  // async loadRecords() {
  //   const data = await this.dbService.getAllVideos();
  //   this.records.set(data);
  // }
}
