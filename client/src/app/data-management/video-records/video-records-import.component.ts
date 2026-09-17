import { Component, inject, signal } from '@angular/core';
import { VideoDatabaseService } from './video-database.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { parseYoutubeContentCsv } from './youtube-csv-import';
import { readFileDurationSecs } from './video-duration';
import { isQuotaExceeded, requestPersistentStorage } from './storage-quota';
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
    <section class="card actions-column">
      <div class="actions">
        <button mat-stroked-button [disabled]="pending()" (click)="insertNewEmpty()">
          <mat-icon>add</mat-icon>
          Create Empty
        </button>
      </div>

      <div class="actions">
        <button mat-stroked-button [disabled]="pending()" (click)="csvInput.click()">
          <mat-icon>add</mat-icon>
          Import From: Youtube Content
        </button>
      </div>

      <div class="actions">
        <button mat-stroked-button [disabled]="pending()" (click)="videoInput.click()">
          <mat-icon>add</mat-icon>
          Create From: Video Files
        </button>
      </div>

      <div class="actions">
        <button mat-stroked-button [disabled]="pending()" (click)="zipInput.click()">
          <mat-icon>upload</mat-icon>
          Import From: Export Zip
        </button>
      </div>

      <!-- One line at the foot rather than one per button: this is a single shared
           signal, written by whichever import last ran, and Create Empty never writes
           it at all. Beside any one button it would report the wrong run. -->
      @if (importSummary()) {
        <p class="action-status">{{ importSummary() }}</p>
      }

      <!-- The pickers the three buttons above open. A hidden input generates no box, so
           it is never a flex item and takes no part in the column wherever it sits -
           collected here rather than one per row, which left each action a different
           shape and made the four rows hard to read as a list. -->
      <input
        type="file"
        #csvInput
        style="display: none"
        accept=".csv"
        (change)="insertFromYoutubeContent($event)"
      />
      <input
        type="file"
        #videoInput
        style="display: none"
        accept="video/*"
        multiple
        (change)="insertFromVideoFiles($event)"
      />
      <input
        type="file"
        #zipInput
        style="display: none"
        accept=".zip"
        (change)="insertFromExportZip($event)"
      />
    </section>
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

    this.importSummary.set(
      `Imported ${rows.length} row(s): ${created} created, ${updated} updated.`,
    );
    input.value = '';
  }

  async insertFromVideoFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    // Copied out before the input is cleared: `files` is live and empties with it.
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;

    this.pending.set(true);
    try {
      // Before any write, so the prompt comes while the user is still at the picker
      // rather than partway through, after the quota has already been hit.
      await requestPersistentStorage();

      const existing = await this.dbService.getAllVideos();
      const byHash = new Map(existing.map((record) => [record.video_file.hash, record]));

      let created = 0;
      let attached = 0;
      let skipped = 0;
      let withoutBytes = 0;
      for (const [index, file] of files.entries()) {
        this.importSummary.set(`Importing ${index + 1} of ${files.length} file(s)...`);
        const file_hash = await calculateSha256(file);
        const match = byHash.get(file_hash);

        if (match?.video_file.file) {
          skipped++;
          continue;
        }

        // A record saved earlier without its bytes: picking the file again is how
        // they get filled in, once there is room for them.
        if (match) {
          try {
            await this.dbService.updateVideo({
              ...match,
              video_file: { ...match.video_file, file },
            });
            attached++;
          } catch (error) {
            if (!isQuotaExceeded(error)) throw error;
            withoutBytes++;
          }
          continue;
        }

        // Read after the duplicate check, not before: a re-scan of a folder that
        // is mostly already imported would otherwise decode every file again for
        // a duration it is about to throw away.
        const duration_secs = await readFileDurationSecs(file);
        const record: Omit<VideoRecord, '__id'> = {
          ...newRecordDefaults(),
          sort_name: file.name,
          video_file: { file, hash: file_hash, exists_on_server: false, duration_secs },
        };

        let __id: number;
        try {
          __id = await this.dbService.addVideo(record);
        } catch (error) {
          if (!isQuotaExceeded(error)) throw error;
          // The name, hash and duration are a few bytes and still identify the video,
          // which is all auto-merge and the server need; only upload needs the file.
          record.video_file = { ...record.video_file, file: null };
          __id = await this.dbService.addVideo(record);
          withoutBytes++;
        }
        byHash.set(file_hash, { ...record, __id });
        created++;
      }

      this.importSummary.set(
        `Processed ${files.length} file(s): ${created} created, ${attached} attached, ` +
          `${skipped} skipped (already exist).` +
          (withoutBytes > 0
            ? ` ${withoutBytes} saved without the video (browser storage full) - pick them again to upload.`
            : ''),
      );
    } catch (error) {
      console.error('Failed to import video files:', error);
      this.importSummary.set(
        error instanceof Error ? error.message : 'Import failed - see console for details.',
      );
    } finally {
      this.pending.set(false);
    }
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
