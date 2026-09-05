import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { VideoDatabaseService } from './video-database.service';
import { MatDialog } from '@angular/material/dialog';
import { SceneStats, Transcript, TranscriptStats, formatDuration, readyData } from './Dataset';
import { readFileDurationSecs } from './video-duration';
import { EditVideoDialogComponent } from './edit-video-dialog.component';
import { MergeVideosDialogComponent } from './merge-videos-dialog.component';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { calculateSha256, VideoRecord } from './VideoRecord';
import { SelectionService } from './selection.service';
import { DatasetActionsService } from './dataset-actions.service';
import {
  DatasetPeekResult,
  STATUS_ICON_STYLES,
  StatusIcon,
  datasetPeekStatusIcon,
  serverStatusIcon,
  datasetStateIcon,
} from './dataset-status';

/**
 * The File and File Hash columns hold the two unbounded strings in the table - an
 * arbitrary filename and a 64-character sha256 - and the table has no width of its
 * own, so left alone they push every column right of them off-screen and force the
 * whole table into a sideways scroll to reach Actions.
 *
 * Truncation lives on an inner span rather than the cell: a `td` in an auto-layout
 * table treats max-width as a suggestion and grows to fit its content anyway, while
 * an inline-block honours it. The full value stays in the DOM either way, so it is
 * still selectable and copyable, and each span carries it as a title tooltip.
 *
 * The hash gets the narrower cap of the two. It is read to tell rows apart and to
 * eyeball against a filename on disk, which the leading characters already settle -
 * whereas a truncated filename can lose the part that distinguishes it.
 */
const TABLE_COLUMN_STYLES = `
  .truncate {
    display: inline-block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }
  .truncate-file {
    max-width: 220px;
  }
  .truncate-hash {
    max-width: 132px;
  }
`;

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
  styles: [STATUS_ICON_STYLES, TABLE_COLUMN_STYLES],
})
export class VideoTableComponent {
  private dialog = inject(MatDialog);
  videoDatabaseService = inject(VideoDatabaseService);
  private selectionService = inject(SelectionService);
  private datasetActions = inject(DatasetActionsService);
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

  // Status/in-flight state lives in DatasetActionsService so the rows reflect actions started
  // from anywhere else too (the Scan tab's bulk buttons, the edit dialog).
  uploadingFile = () => this.datasetActions.uploadingFile();
  sendingTranscript = () => this.datasetActions.sendingTranscript();
  sendingSceneStats = () => this.datasetActions.sendingSceneStats();

  checkTranscriptStatus = (hash: string) => this.datasetActions.checkTranscriptStatus(hash);
  checkSceneStatsStatus = (hash: string) => this.datasetActions.checkSceneStatsStatus(hash);

  constructor() {
    effect(() => {
      const records = this.videoDatabaseService.videoRecords();
      this.dataSource.data = records;
      // Drop any selected rows that no longer exist (e.g. after a delete).
      const stillPresent = this.selection.selected.filter((record) => records.includes(record));
      this.selection.clear();
      if (stillPresent.length > 0) this.selection.select(...stillPresent);

      // Hand the on-screen hashes to DatasetActionsService, which owns keeping their badges
      // fresh. It reads no signals, so this effect stays subscribed to videoRecords() alone -
      // checking the status maps here instead would re-run it once per status write, and
      // re-walk every record each time.
      this.datasetActions.trackHashes(
        records.map((record) => record.video_file.hash).filter((hash) => !!hash),
      );
    });
  }

  getServerStatusIcon(record: VideoRecord): StatusIcon | null {
    if (!record.video_file.hash) return null;
    const status =
      this.datasetActions.serverStatusByHash().get(record.video_file.hash) ?? 'checking';
    return serverStatusIcon(status, {
      hasLocalFile: !!record.video_file.file,
      uploading: this.uploadingFile().has(record.video_file.hash),
    });
  }

  // Picks a local video file for a row directly from the table (no need to open the
  // edit dialog): computes its hash and attaches it, ready for uploadFileToServer.
  onFileSelected = (record: VideoRecord, event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    record.video_file.file = file;
    // Both reads are over the same file and neither depends on the other, so
    // they run together and persist once rather than writing the record twice.
    Promise.all([calculateSha256(file), readFileDurationSecs(file)]).then(([hash, duration]) => {
      record.video_file.hash = hash;
      record.video_file.duration_secs = duration;
      this.videoDatabaseService.updateVideo(record);
    });

    input.value = '';
  };

  // The file-hash column's button doubles as an upload trigger: if a local file is
  // attached and the server doesn't have it yet, clicking sends it; otherwise this
  // just re-checks status (same as before this row had upload capability).
  async uploadFileToServer(record: VideoRecord): Promise<void> {
    try {
      if ((await this.datasetActions.uploadFile(record)) === 'uploaded') {
        await this.videoDatabaseService.updateVideo(record);
      }
    } catch (error) {
      console.error('Failed to upload video:', error);
    }
  }

  private getDatasetStatusIcon(
    record: VideoRecord,
    statusMap: Map<string, DatasetPeekResult>,
  ): StatusIcon | null {
    if (!record.video_file.hash) return null;
    const result = statusMap.get(record.video_file.hash) ?? { status: 'checking' };
    return datasetPeekStatusIcon(result);
  }

  /**
   * Whether the server holds a finished dataset that this browser does not.
   *
   * This is the one state the table had no action for. The cell shows the fetch button only in
   * the branch where the data is already here, and the other branch's button merely re-peeks -
   * so a dataset sitting ready on the server could be looked at and never collected. The badge
   * even said so ("Ready on server - not fetched yet") with no way to act on it.
   */
  private isReadyOnServer(
    record: VideoRecord,
    statusMap: Map<string, DatasetPeekResult>,
  ): boolean {
    const hash = record.video_file.hash;
    return !!hash && statusMap.get(hash)?.status === 'ready';
  }

  transcriptReadyOnServer(record: VideoRecord): boolean {
    return this.isReadyOnServer(record, this.datasetActions.transcriptStatusByHash());
  }

  sceneStatsReadyOnServer(record: VideoRecord): boolean {
    return this.isReadyOnServer(record, this.datasetActions.sceneStatsStatusByHash());
  }

  // The template used to test these fields for truthiness to mean "has data".
  // DatasetState is always truthy - 'absent' is a value, not a null - so the
  // question has to be asked explicitly now.
  transcriptData(record: VideoRecord): Transcript | null {
    return readyData(record.ds_transcript);
  }

  transcriptStatsData(record: VideoRecord): TranscriptStats | null {
    return readyData(record.ds_transcriptStats);
  }

  sceneStatsData(record: VideoRecord): SceneStats | null {
    return readyData(record.ds_sceneStats);
  }

  protected readonly formatDuration = formatDuration;

  /**
   * How long the video is, from whichever source has an answer: the YouTube
   * export first, then the server's scene stats (OpenCV over the uploaded
   * file), then the file sitting in the browser. Null when none of them do.
   *
   * Each tier is gated on > 0, not merely on being present, so a zero from a
   * probe that opened a file but got nothing useful out of it falls through to
   * the next source instead of winning and rendering as "0:00". This mirrors
   * the `duration_secs <= 0` guard the analysis pipeline already applies.
   */
  private durationTiers(record: VideoRecord): { secs: number; source: string }[] {
    const candidates = [
      { secs: record.ds_youtubeContent?.duration_secs, source: 'From YouTube content report' },
      { secs: this.sceneStatsData(record)?.duration_secs, source: 'From video file (scene stats)' },
      { secs: record.video_file.duration_secs, source: 'From local video file' },
    ];
    return candidates.filter(
      (tier): tier is { secs: number; source: string } => (tier.secs ?? 0) > 0,
    );
  }

  durationSecs(record: VideoRecord): number | null {
    return this.durationTiers(record)[0]?.secs ?? null;
  }

  /** Provenance of the value above, shown as the cell's tooltip. */
  durationSource(record: VideoRecord): string | null {
    return this.durationTiers(record)[0]?.source ?? null;
  }

  getTranscriptStatusIcon(record: VideoRecord): StatusIcon | null {
    return this.getDatasetStatusIcon(record, this.datasetActions.transcriptStatusByHash());
  }

  getSceneStatsStatusIcon(record: VideoRecord): StatusIcon | null {
    return this.getDatasetStatusIcon(record, this.datasetActions.sceneStatsStatusByHash());
  }

  getTranscriptUploadIcon(record: VideoRecord): StatusIcon | null {
    return datasetStateIcon(
      record.ds_transcript,
      this.sendingTranscript().has(record.video_file.hash),
    );
  }

  getSceneStatsUploadIcon(record: VideoRecord): StatusIcon | null {
    return datasetStateIcon(
      record.ds_sceneStats,
      this.sendingSceneStats().has(record.video_file.hash),
    );
  }

  async sendTranscriptToServer(record: VideoRecord): Promise<void> {
    try {
      await this.datasetActions.fetchTranscript(record);
    } catch (error) {
      console.error('Failed to send transcript to server:', error);
    } finally {
      // Persists either outcome - on failure the record carries a 'failed' upload state.
      await this.videoDatabaseService.updateVideo(record);
    }
  }

  async sendSceneStatsToServer(record: VideoRecord): Promise<void> {
    try {
      await this.datasetActions.fetchSceneStats(record);
    } catch (error) {
      console.error('Failed to send scene stats to server:', error);
    } finally {
      await this.videoDatabaseService.updateVideo(record);
    }
  }

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
    'duration',
    'file',
    'file-hash',
    'youtube-content-report',
    'youtube-audience-retention',
    'transcript',
    'transcript-stats',
    'scene-stats',
    'actions',
  ];

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  getFileDisplayValue = (element: VideoRecord): string | null =>
    element.video_file.file?.name || element.video_file.hash || null;

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
        if (record.__id != null) {
          await this.videoDatabaseService.deleteVideo(record.__id);
        }
      }
      this.selection.clear();
    } finally {
      this.bulkActionPending.set(false);
    }
  }

  mergeSelected(): void {
    const records = this.selection.selected;
    if (records.length < 2) return;

    const dialogRef = this.dialog.open(MergeVideosDialogComponent, { data: records });
    dialogRef.afterClosed().subscribe(async (merged: Omit<VideoRecord, '__id'> | undefined) => {
      if (!merged) return;

      this.bulkActionPending.set(true);
      try {
        await this.videoDatabaseService.addVideo(merged);
        for (const record of records) {
          if (record.__id != null) {
            await this.videoDatabaseService.deleteVideo(record.__id);
          }
        }
        this.selection.clear();
      } finally {
        this.bulkActionPending.set(false);
      }
    });
  }
}
