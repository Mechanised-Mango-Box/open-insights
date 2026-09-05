import { Component, inject, signal } from '@angular/core';
import { VideoDatabaseService } from './video-database.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { parseYoutubeContentCsv } from './youtube-csv-import';
import { readFileDurationSecs } from './video-duration';
import { fillGaps, ImportedRecord, parseExportZip } from './manifest-import';
import { calculateSha256, VideoFile, VideoRecord } from './VideoRecord';

/** Shared "blank slate" for every dataset field a freshly-created VideoRecord needs
 * beyond sort_name - kept in one place so each creation site only supplies what's
 * actually known at that point. */
const newRecordDefaults = (): Omit<VideoRecord, '__id' | 'sort_name'> => ({
  video_file: VideoFile.createEmpty(),
  ds_youtubeContent: null,
  ds_youtubeAudienceRetention: null,
  ds_transcript: { state: 'absent' },
  ds_transcriptStats: { state: 'absent' },
  ds_sceneStats: { state: 'absent' },
});

@Component({
  selector: 'video-records-import',
  template: `
    <div class="import-actions">
      <button mat-raised-button color="primary" [disabled]="pending()" (click)="insertNewEmpty()">
        <mat-icon>add</mat-icon>
        Create Empty
      </button>
      <button mat-raised-button color="accent" [disabled]="pending()" (click)="csvInput.click()">
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
      <button mat-raised-button color="accent" [disabled]="pending()" (click)="videoInput.click()">
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
      <button mat-raised-button color="accent" [disabled]="pending()" (click)="zipInput.click()">
        <mat-icon>upload</mat-icon>
        Import From: Export Zip
      </button>
      <input
        type="file"
        #zipInput
        style="display: none"
        accept=".zip"
        (change)="insertFromExportZip($event)"
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

  importSummary = signal<string | null>(null);
  /** Unpacking a zip full of video files is slow enough to need the buttons held shut. */
  pending = signal(false);

  async insertNewEmpty() {
    const sampleRecord: VideoRecord = {
      sort_name: 'Untitled New Record',
      ...newRecordDefaults(),
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
        await this.dbService.addVideo({
          ...newRecordDefaults(),
          sort_name: row.title,
          ds_youtubeContent: row.content,
        });
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
    const existingHashes = new Set(existing.map((record) => record.video_file.hash));

    let created = 0;
    let skipped = 0;
    for (const file of Array.from(files)) {
      const file_hash = await calculateSha256(file);
      if (existingHashes.has(file_hash)) {
        skipped++;
        continue;
      }

      // Read after the duplicate check, not before: a re-scan of a folder that
      // is mostly already imported would otherwise decode every file again for
      // a duration it is about to throw away.
      const duration_secs = await readFileDurationSecs(file);

      await this.dbService.addVideo({
        ...newRecordDefaults(),
        sort_name: file.name,
        video_file: { file, hash: file_hash, exists_on_server: false, duration_secs },
      });
      existingHashes.add(file_hash);
      created++;
    }

    this.importSummary.set(
      `Processed ${files.length} file(s): ${created} created, ${skipped} skipped (already exist).`,
    );
    input.value = '';
  }

  /**
   * Reads back a zip produced by the Export step. Records already in the library are filled
   * in rather than replaced (see fillGaps), so importing the same zip twice is a no-op and
   * importing an older one cannot undo newer local work.
   */
  async insertFromExportZip(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.pending.set(true);
    this.importSummary.set('Reading export...');
    try {
      const imported = await parseExportZip(file, (done, total) =>
        this.importSummary.set(`Reading ${done} of ${total} record(s)...`),
      );
      const existing = await this.dbService.getAllVideos();

      let created = 0;
      let updated = 0;
      let unchanged = 0;
      for (const record of imported) {
        const match = this.findMatch(existing, record);
        if (!match) {
          const __id = await this.dbService.addVideo(record);
          // Pushed into `existing` so a zip holding two records for one video merges the
          // second into the row the first just created, rather than adding a duplicate.
          // With the key addVideo just assigned: without it that merge would reach
          // updateVideo, which refuses a record it cannot address.
          existing.push({ ...record, __id });
          created++;
          continue;
        }

        const merged = fillGaps(match, record);
        if (!merged) {
          unchanged++;
          continue;
        }
        await this.dbService.updateVideo(merged);
        Object.assign(match, merged);
        updated++;
      }

      this.importSummary.set(
        `Imported ${imported.length} record(s): ${created} created, ${updated} updated, ` +
          `${unchanged} unchanged.`,
      );
    } catch (error) {
      console.error('Failed to import export zip:', error);
      this.importSummary.set(
        error instanceof Error ? error.message : 'Import failed - see console for details.',
      );
    } finally {
      this.pending.set(false);
    }
  }

  /**
   * Finds the record an imported one belongs to. The video hash is the real identity; the
   * YouTube content id is a fallback for records exported without a file, and is the same
   * key insertFromYoutubeContent already matches on. A record with neither has no identity
   * to match by, so it is always created.
   */
  private findMatch(existing: VideoRecord[], incoming: ImportedRecord): VideoRecord | undefined {
    const hash = incoming.video_file.hash;
    if (hash) {
      const byHash = existing.find((record) => record.video_file.hash === hash);
      if (byHash) return byHash;
    }

    const content = incoming.ds_youtubeContent?.content;
    if (!content) return undefined;
    return existing.find((record) => record.ds_youtubeContent?.content === content);
  }
}
