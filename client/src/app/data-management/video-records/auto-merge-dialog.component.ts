import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { VideoRecord } from './VideoRecord';
import { formatDuration } from './Dataset';
import { recordDurationSecs } from './video-duration';
import { VideoDatabaseService } from './video-database.service';
import {
  AutoMergePair,
  AutoMergeResult,
  fileTitle,
  findAutoMergePairs,
  mergePair,
} from './auto-merge';

export type AutoMergeOutcome = { merged: number; skipped: number };

/**
 * Lists the pairs Auto-Merge found, all ticked, then merges the ones left ticked.
 *
 * The merge runs in here rather than in the table so the dialog can stay open over it as the
 * waiting screen: each pair is several IndexedDB writes, and a large library takes long enough
 * that a dialog which closed straight away would leave rows vanishing with no explanation.
 */
@Component({
  selector: 'app-auto-merge-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatProgressBarModule,
  ],
  templateUrl: './auto-merge-dialog.component.html',
})
export class AutoMergeDialogComponent {
  readonly dialogRef = inject(MatDialogRef<AutoMergeDialogComponent, AutoMergeOutcome>);
  readonly data = inject<VideoRecord[]>(MAT_DIALOG_DATA);
  private dbService = inject(VideoDatabaseService);

  readonly result: AutoMergeResult = findAutoMergePairs(this.data);

  readonly ticked = signal<Set<AutoMergePair>>(new Set(this.result.pairs));
  readonly tickedCount = computed(() => this.ticked().size);

  /** Null until Merge is clicked; from then on, how far through the ticked pairs it is. */
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly progressPercent = computed(() => {
    const progress = this.progress();
    return progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  });

  readonly fileTitle = fileTitle;

  youtubeDuration(pair: AutoMergePair): string {
    const secs = pair.youtube.ds_youtubeContent?.duration_secs;
    return secs ? formatDuration(secs) : '?';
  }

  fileDuration(pair: AutoMergePair): string {
    const secs = recordDurationSecs(pair.file);
    return secs ? formatDuration(secs) : '?';
  }

  toggle(pair: AutoMergePair): void {
    this.ticked.update((current) => {
      const next = new Set(current);
      if (!next.delete(pair)) next.add(pair);
      return next;
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  async onMerge(): Promise<void> {
    const pairs = this.result.pairs.filter((pair) => this.ticked().has(pair));
    // Held open until the last write lands: closing part-way would leave half the pairs merged
    // with nothing on screen saying so.
    this.dialogRef.disableClose = true;
    this.progress.set({ done: 0, total: pairs.length });

    const outcome: AutoMergeOutcome = { merged: 0, skipped: 0 };
    try {
      for (const pair of pairs) {
        const record = mergePair(pair);
        if (record) {
          await this.dbService.addVideo(record);
          for (const source of [pair.youtube, pair.file]) {
            if (source.__id != null) await this.dbService.deleteVideo(source.__id);
          }
          outcome.merged++;
        } else {
          outcome.skipped++;
        }
        this.progress.update((current) => current && { ...current, done: current.done + 1 });
      }
    } finally {
      this.dialogRef.disableClose = false;
      this.dialogRef.close(outcome);
    }
  }
}
