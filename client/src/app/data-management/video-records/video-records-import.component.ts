import { Component, inject, signal } from '@angular/core';
import { VideoDatabaseService } from './video-database.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { parseYoutubeContentCsv } from './youtube-csv-import';
import { readFileDurationSecs } from './video-duration';
import { isQuotaExceeded, requestPersistentStorage } from './storage-quota';
import { fillGaps, ImportedRecord, parseExportZip } from './manifest-import';
import { calculateSha256, VideoFile, VideoRecord } from './VideoRecord';
import { isAcceptedVideoName, VIDEO_EXTENSIONS_LABEL, VIDEO_FILE_ACCEPT } from './video-file-types';
import { DURATION_TOLERANCE_SECS } from './auto-merge';

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
  ds_textStats: { state: 'absent' },
  ds_audioStats: { state: 'absent' },
});

/** Which picker the shared summary line belongs to, so it shows in that card only. */
type ImportSource = 'youtube' | 'videos' | 'zip';

/**
 * The Import step: one card per place records come from, each with the button that
 * reads it and a collapsed guide to getting the file in the first place - the YouTube
 * exports in particular have to be pulled out of Studio in a specific shape, and
 * nothing in the picker says which file of the three in its zip is the right one.
 *
 * The cards sit in the order a dataset is usually built: the YouTube report, then the
 * videos, then the follow-up card on pairing the two and adding per-video extras.
 */
@Component({
  selector: 'video-records-import',
  template: `
    <div class="view-stack">
      <div class="view-block sources">
        <section class="card">
          <h2 class="card-title"><mat-icon>table_chart</mat-icon> YouTube content report</h2>
          <p class="card-lead">
            One row per video: title, length and average view duration - the engagement Analysis and
            the models measure against. Creates a record per video; a newer report updates the same
            records.
          </p>
          <div class="actions">
            <button mat-stroked-button [disabled]="pending()" (click)="csvInput.click()">
              <mat-icon>upload_file</mat-icon>
              Import Content Report (.csv)
            </button>
            @if (summaryFor('youtube'); as summary) {
              <p class="action-status">{{ summary }}</p>
            }
          </div>
          <mat-expansion-panel class="guide">
            <mat-expansion-panel-header>
              <mat-panel-title>How to get this file</mat-panel-title>
            </mat-expansion-panel-header>
            <ol>
              <li>
                In YouTube Studio, open <strong>Analytics</strong> and choose
                <strong>Advanced mode</strong>.
              </li>
              <li>
                On the <strong>Content</strong> tab, set the date range to cover your videos (<em
                  >Lifetime</em
                >
                is simplest).
              </li>
              <li>
                Make sure the table shows <strong>Duration</strong> and
                <strong>Average view duration</strong>; add either from the column picker if it is
                missing.
              </li>
              <li>
                Choose <strong>Export current view</strong> →
                <strong>Comma-separated values (.csv)</strong>.
              </li>
              <li>
                Unzip the download and pick <code>Table data.csv</code>. The
                <code>Chart data</code> and <code>Totals</code> files beside it are not used.
              </li>
            </ol>
            <p class="guide-note">
              Columns read: <code>Content</code> (the video ID), <code>Video title</code>,
              <code>Duration</code> and <code>Average view duration</code>; views, watch time,
              subscribers and impressions are kept when present.
            </p>
          </mat-expansion-panel>
        </section>

        <section class="card">
          <h2 class="card-title"><mat-icon>movie</mat-icon> Video files</h2>
          <p class="card-lead">
            What Scan measures. Creates a record per file; a file already in the library is skipped.
            The files stay in this browser until a scan sends them to the server.
          </p>
          <div class="actions">
            <button mat-stroked-button [disabled]="pending()" (click)="videoInput.click()">
              <mat-icon>video_file</mat-icon>
              Add Video Files
            </button>
            @if (summaryFor('videos'); as summary) {
              <p class="action-status">{{ summary }}</p>
            }
          </div>
          <mat-expansion-panel class="guide">
            <mat-expansion-panel-header>
              <mat-panel-title>How to get these files</mat-panel-title>
            </mat-expansion-panel-header>
            <ul>
              <li>
                <strong>The originals</strong> - the files you uploaded, or the recordings from your
                lecture-capture system - are best: full resolution makes on-screen text easier to
                read.
              </li>
              <li>
                <strong>From YouTube Studio</strong>: <strong>Content</strong> → hover a video →
                <strong>⋮ Options</strong> → <strong>Download</strong>. YouTube hands back an MP4 at
                720p or 360p, one video at a time, at most five times a day per video.
              </li>
            </ul>
            <p class="guide-note">
              Accepted: {{ videoExtensions }}. Pick as many as you like at once. Keep the video's
              title as its file name (Studio's download already does) so Auto-Merge can pair it with
              its row from the content report.
            </p>
          </mat-expansion-panel>
        </section>

        <section class="card no-guide">
          <h2 class="card-title"><mat-icon>folder_zip</mat-icon> Open Insights export</h2>
          <p class="card-lead">
            A zip from the Export step, from this browser or another. Fills in what is missing and
            never overwrites newer work here, so importing the same zip twice changes nothing.
          </p>
          <div class="actions">
            <button mat-stroked-button [disabled]="pending()" (click)="zipInput.click()">
              <mat-icon>unarchive</mat-icon>
              Import Export Zip
            </button>
            @if (summaryFor('zip'); as summary) {
              <p class="action-status">{{ summary }}</p>
            }
          </div>
        </section>

        <section class="card no-guide">
          <h2 class="card-title"><mat-icon>note_add</mat-icon> Blank record</h2>
          <p class="card-lead">
            An empty record to fill in by hand with its <strong>Edit</strong> button in the table
            below.
          </p>
          <div class="actions">
            <button mat-stroked-button [disabled]="pending()" (click)="insertNewEmpty()">
              <mat-icon>add</mat-icon>
              Create Empty Record
            </button>
          </div>
        </section>
      </div>

      <section class="card">
        <h2 class="card-title"><mat-icon>checklist</mat-icon> After importing</h2>
        <h3>Pair reports with videos</h3>
        <p class="card-lead">
          The content report and the video files each create records of their own. Press
          <strong>Auto-Merge</strong> above the table to pair them by name and length (within
          {{ durationTolerance }} s); <strong>Merge Selected</strong> joins any it misses. Analysis
          needs both halves in one record.
        </p>
        <h3>Add per-video extras</h3>
        <p class="card-lead">
          A record's <strong>Edit</strong> button takes two more files, each for one video:
        </p>
        <mat-expansion-panel class="guide">
          <mat-expansion-panel-header>
            <mat-panel-title>Audience retention (.csv)</mat-panel-title>
          </mat-expansion-panel-header>
          <ol>
            <li>
              In YouTube Studio, open the video's <strong>Analytics</strong> and its
              <strong>Engagement</strong> tab.
            </li>
            <li>Under <strong>Audience retention</strong>, choose <strong>See more</strong>.</li>
            <li>
              Choose <strong>Export current view</strong> →
              <strong>Comma-separated values (.csv)</strong> and unzip it.
            </li>
          </ol>
          <p class="guide-note">
            Pick the file with the columns <code>Video position (%)</code> and
            <code>Absolute audience retention (%)</code>. It is kept and exported with the record;
            Analysis does not use it yet.
          </p>
        </mat-expansion-panel>
        <mat-expansion-panel class="guide">
          <mat-expansion-panel-header>
            <mat-panel-title>Transcript (.srt or .vtt)</mat-panel-title>
          </mat-expansion-panel-header>
          <ol>
            <li>In YouTube Studio, open the video and choose <strong>Subtitles</strong>.</li>
            <li>
              On the language's row, choose <strong>⋮</strong> → <strong>Download</strong> →
              <strong>.srt</strong>.
            </li>
          </ol>
          <p class="guide-note">
            Optional: Scan's <strong>Extract Transcript</strong> makes one from the video itself.
            Use your captions instead when they are more accurate - but running Extract Transcript
            on the record afterwards replaces them.
          </p>
        </mat-expansion-panel>
      </section>
    </div>

    <!-- The pickers the buttons above open. Hidden inputs generate no box, so they
         take no part in the layout wherever they sit - collected here rather than
         one per card. -->
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
      [accept]="videoFileAccept"
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
  `,
  styles: [
    `
      /* Two columns of sources where there is room, so the four fit above the record
         table without a long scroll.

         Each card spans four rows of the outer grid - title, description, button,
         guide - and lays its own children on those rows through subgrid. So the two
         cards in a row share each row's height: their buttons line up however long
         either description is, and opening one guide grows only the guide row, not
         the space above its neighbour's button. */
      .sources {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
        column-gap: 16px;
        row-gap: 16px;
      }
      .sources .card {
        display: grid;
        grid-row: span 4;
        grid-template-rows: subgrid;
        row-gap: 8px;
        align-content: start;
      }
      /* No guide, so no fourth row - spanning one anyway would leave a gap's worth
         of empty card at the bottom. */
      .sources .card.no-guide {
        grid-row: span 3;
      }
      .sources .card-lead {
        margin: 0;
      }
      /* Its own height, not the row's: a closed guide beside an open one stays a
         closed header rather than an empty box. */
      .sources .guide {
        align-self: start;
      }
      .card-title {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .card-title mat-icon {
        color: var(--mat-sys-primary);
      }
      /* A flat panel: it sits inside a card, so it borrows the card's surface
         and keeps only a rule to say where it starts. */
      .guide {
        --mat-expansion-header-collapsed-state-height: 40px;
        --mat-expansion-header-expanded-state-height: 48px;
        --mat-expansion-header-text-size: var(--mat-sys-label-large-size);
        /* Body text the size of the card's own, not Material's larger default. */
        --mat-expansion-container-text-size: var(--mat-sys-body-medium-size);
        --mat-expansion-container-text-line-height: var(--mat-sys-body-medium-line-height);
        box-shadow: none;
        background: transparent;
        border: 1px solid var(--mat-sys-outline-variant);
        margin-top: 4px;
      }
      .guide + .guide {
        margin-top: 8px;
      }
      .guide ol,
      .guide ul {
        margin: 0 0 8px;
        padding-left: 20px;
      }
      .guide li {
        margin-bottom: 4px;
      }
      .guide-note {
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
        margin: 0;
      }
      code {
        font-size: 0.9em;
      }
    `,
  ],
  imports: [MatIcon, MatButtonModule, MatExpansionModule],
})
export class VideoRecordsImport {
  private dbService = inject(VideoDatabaseService);

  importSummary = signal<string | null>(null);
  /** Which import wrote importSummary. One shared line, shown only in the card of
   * the run it describes - beside any other button it would report the wrong one. */
  private summarySource = signal<ImportSource | null>(null);
  /** Unpacking a zip full of video files is slow enough to need the buttons held shut. */
  pending = signal(false);

  protected readonly videoFileAccept = VIDEO_FILE_ACCEPT;
  protected readonly videoExtensions = VIDEO_EXTENSIONS_LABEL;
  protected readonly durationTolerance = DURATION_TOLERANCE_SECS;

  protected summaryFor(source: ImportSource): string | null {
    return this.summarySource() === source ? this.importSummary() : null;
  }

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

    this.summarySource.set('youtube');
    this.importSummary.set(null);
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
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (picked.length === 0) return;
    this.summarySource.set('videos');
    this.importSummary.set(null);

    // `accept` only sets the picker's default filter; "All files" gets past it, and
    // the server would refuse these at upload anyway.
    const files = picked.filter((file) => isAcceptedVideoName(file.name));
    const refused = picked.length - files.length;
    const refusedNote = refused > 0 ? ` ${refused} refused (not ${VIDEO_EXTENSIONS_LABEL}).` : '';
    if (files.length === 0) {
      this.importSummary.set(`Nothing imported.${refusedNote}`);
      return;
    }

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
          refusedNote +
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
    this.summarySource.set('zip');
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
