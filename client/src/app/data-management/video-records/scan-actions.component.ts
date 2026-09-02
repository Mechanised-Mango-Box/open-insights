import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { SelectionService } from './selection.service';
import { VideoDatabaseService } from './video-database.service';
import { DatasetServerService } from '../dataset-server.service';
import { VideoRecord } from './VideoRecord';

@Component({
  selector: 'scan-actions',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    <div class="scan-actions">
      <p>{{ selectionService.selectedCount() }} record(s) selected.</p>

      <button
        mat-raised-button
        color="primary"
        [disabled]="selectionService.isEmpty() || pending()"
        (click)="extractTranscript()"
      >
        Extract Transcript
      </button>
      <button
        mat-raised-button
        [disabled]="selectionService.isEmpty() || pending()"
        (click)="extractTranscriptStats()"
      >
        Extract Transcript Stats
      </button>
      <button
        mat-raised-button
        color="accent"
        [disabled]="selectionService.isEmpty() || pending()"
        (click)="extractSceneStats()"
      >
        Extract Scene Stats
      </button>

      @if (status()) {
      <p>{{ status() }}</p>
      }
    </div>
  `,
  styles: [
    `
      .scan-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        padding: 16px 0;
      }
    `,
  ],
})
export class ScanActionsComponent {
  selectionService = inject(SelectionService);
  private dbService = inject(VideoDatabaseService);
  private datasetServerService = inject(DatasetServerService);

  pending = signal(false);
  status = signal<string | null>(null);

  extractTranscript(): Promise<void> {
    return this.runBulk('transcript', async (record) => {
      const { transcript, stats } = await this.fetchOrUpload(record, () =>
        this.datasetServerService.getTranscript(record.video_file.hash),
      );
      record.ds_transcript = { upload_state: { is_local: false }, data: transcript };
      record.ds_transcriptStats = { upload_state: { is_local: false }, data: stats };
    });
  }

  extractTranscriptStats(): Promise<void> {
    // Recomputes count_chars/count_words from an already-fetched transcript, locally -
    // no server round-trip. Mirrors the old app's separate "Calculate Transcript Stats"
    // action, useful after a transcript's text was edited/imported without its stats
    // being refreshed. Requires a transcript to already be set (run Extract Transcript first).
    return this.runBulk('transcript stats', async (record) => {
      if (!record.ds_transcript || !('text' in record.ds_transcript.data)) {
        throw new Error('No transcript to compute stats from - run Extract Transcript first.');
      }
      const text = record.ds_transcript.data.text;
      const words = text.trim().length ? text.trim().split(/\s+/) : [];
      record.ds_transcriptStats = {
        upload_state: { is_local: true, server_side_state: 'ready' },
        data: { count_chars: text.length, count_words: words.length },
      };
    });
  }

  extractSceneStats(): Promise<void> {
    return this.runBulk('scene stats', async (record) => {
      const sceneStats = await this.fetchOrUpload(record, () =>
        this.datasetServerService.getSceneStats(record.video_file.hash),
      );
      record.ds_sceneStats = { upload_state: { is_local: false }, data: sceneStats };
    });
  }

  private async runBulk(
    label: string,
    action: (record: VideoRecord) => Promise<void>,
  ): Promise<void> {
    const records = this.selectionService.selection.selected;
    if (records.length === 0) return;

    this.pending.set(true);
    let succeeded = 0;
    let failed = 0;

    try {
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        this.status.set(`Extracting ${label}: ${i + 1} of ${records.length}...`);
        try {
          await action(record);
          await this.dbService.updateVideo(record);
          succeeded++;
        } catch (error) {
          console.error(`Failed to extract ${label} for record ${record.__id}:`, error);
          failed++;
        }
      }
      this.status.set(`Done: ${succeeded} succeeded, ${failed} failed.`);
    } finally {
      this.pending.set(false);
    }
  }

  // Tries the server first (cheap - covers "already uploaded" and "already cached"). Only
  // sends the file over the network on a 404 (server has no video for this hash yet), and
  // only if we actually have the bytes in memory this session.
  private async fetchOrUpload<T>(record: VideoRecord, fetchFn: () => Promise<T>): Promise<T> {
    if (!record.video_file.hash) {
      throw new Error('No file hash for this record.');
    }
    try {
      return await fetchFn();
    } catch (error) {
      const notFound = error instanceof HttpErrorResponse && error.status === 404;
      if (notFound && record.video_file.file) {
        await this.datasetServerService.uploadVideo(record.video_file.file);
        return await fetchFn();
      }
      throw error;
    }
  }
}
