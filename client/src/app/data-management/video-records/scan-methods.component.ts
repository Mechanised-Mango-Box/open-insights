import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { ComputeConfigService } from '../compute-config.service';
import { ComputeQueueService } from '../local-compute/compute-queue.service';
import { DATASET_KINDS, DatasetKind, ProviderStatus } from '../providers/dataset-provider';
import { ServerDatasetProvider } from '../providers/server-dataset.provider';
import { ServerConfigService } from '../server-config.service';
import { DatasetSettings, DatasetState, isReady } from './Dataset';
import {
  TRANSCRIPT_STATS_METHOD,
  TRANSCRIPT_STATS_SETTINGS,
  settingsRows,
} from './dataset-settings';
import { VideoDatabaseService } from './video-database.service';
import { VideoRecord } from './VideoRecord';

type MethodRow = {
  key: string;
  label: string;
  where: string;
  method: string | null;
  settings: { key: string; label: string; value: string }[];
  /** Records holding a result of this kind made with other settings than these. */
  differing: number;
};

const KIND_LABELS: Record<DatasetKind | 'transcript_stats', string> = {
  transcript: 'Transcript',
  transcript_stats: 'Transcript stats',
  scene_stats: 'Scene stats',
  text_stats: 'Screen text',
  audio_stats: 'Audio stats',
};

const RECORD_FIELD: Record<
  DatasetKind | 'transcript_stats',
  (r: VideoRecord) => DatasetState<unknown> | undefined
> = {
  transcript: (r) => r.ds_transcript,
  transcript_stats: (r) => r.ds_transcriptStats,
  scene_stats: (r) => r.ds_sceneStats,
  text_stats: (r) => r.ds_textStats,
  audio_stats: (r) => r.ds_audioStats,
};

const sameSettings = (a: DatasetSettings | undefined, b: DatasetSettings | undefined) =>
  JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

/**
 * "How Scan calculates its data": for each kind of result, where it runs, how it
 * is calculated and every threshold it uses, with units.
 *
 * Nothing is written down here. A kind that runs on the server is described by
 * the server's own /status (the method and settings in server/config.py), and one
 * that runs in this browser by its computer - so this always describes the scan
 * that would actually run, wherever that is.
 */
@Component({
  selector: 'scan-methods',
  standalone: true,
  imports: [MatButtonModule, MatExpansionModule],
  template: `
    <mat-expansion-panel (opened)="load()">
      <mat-expansion-panel-header>
        <mat-panel-title>How Scan calculates its data</mat-panel-title>
        <mat-panel-description>Methods and thresholds</mat-panel-description>
      </mat-expansion-panel-header>

      @if (error()) {
        <p class="method-warning">{{ error() }}</p>
      }
      @for (row of rows(); track row.key) {
        <h3 class="method-heading">{{ row.label }}</h3>
        <dl class="method-list">
          <dt>Runs on</dt>
          <dd>{{ row.where }}</dd>
          <dt>Method</dt>
          <dd>{{ row.method ?? 'Not reported by this server.' }}</dd>
          <dt>Settings</dt>
          <dd>
            @if (row.settings.length) {
              @for (s of row.settings; track s.key) {
                {{ s.label }} <strong>{{ s.value }}</strong>
                @if (!$last) {
                  ,
                }
              }
            } @else {
              Not reported by this server.
            }
          </dd>
          @if (row.differing) {
            <dt>Your records</dt>
            <dd>
              {{ row.differing }} record(s) hold a result made with other settings. Hover a record's
              status icon to see which; scanning again recomputes it with these.
            </dd>
          }
        </dl>
      }
      <p class="method-note">
        Every result also records the settings it was made with: hover its status icon in the table
        below. The derived features the Analysis and Recommend steps use are explained on those
        pages.
      </p>
      <button mat-stroked-button (click)="load()">Refresh</button>
    </mat-expansion-panel>
  `,
})
export class ScanMethodsComponent {
  private computeConfig = inject(ComputeConfigService);
  private queue = inject(ComputeQueueService);
  private server = inject(ServerDatasetProvider);
  private serverConfig = inject(ServerConfigService);
  private videoDatabase = inject(VideoDatabaseService);

  private status = signal<ProviderStatus | null>(null);
  protected error = signal<string | null>(null);

  constructor() {
    // The server's answer belongs to the server that gave it.
    effect(() => {
      this.serverConfig.serverUrl();
      untracked(() => this.status.set(null));
    });
  }

  protected rows = computed<MethodRow[]>(() => {
    const status = this.status();
    const records = this.videoDatabase.videoRecords();
    const serverUrl = this.serverConfig.serverUrl();

    const describe = (
      key: DatasetKind | 'transcript_stats',
      where: string,
      method: string | null,
      settings: DatasetSettings | undefined,
    ): MethodRow => ({
      key,
      label: KIND_LABELS[key],
      where,
      method,
      settings: settingsRows(settings),
      differing: settings
        ? records.filter((r) => {
            const held = RECORD_FIELD[key](r);
            return isReady(held) && !!held.settings && !sameSettings(held.settings, settings);
          }).length
        : 0,
    });

    const rows: MethodRow[] = [];
    for (const kind of DATASET_KINDS) {
      if (this.computeConfig.targetFor(kind) === 'local') {
        const computer = this.queue.computerFor(kind);
        rows.push(describe(kind, 'This browser', computer?.method ?? null, computer?.settings));
      } else {
        const reported = status?.kinds[kind];
        rows.push(describe(kind, serverUrl, reported?.method ?? null, reported?.settings));
      }
      if (kind === 'transcript') {
        rows.push(
          describe(
            'transcript_stats',
            'This browser',
            TRANSCRIPT_STATS_METHOD,
            TRANSCRIPT_STATS_SETTINGS,
          ),
        );
      }
    }
    return rows;
  });

  /** Asks the server only when the panel is opened, and again on Refresh. */
  async load(): Promise<void> {
    if (!DATASET_KINDS.some((kind) => this.computeConfig.targetFor(kind) === 'server')) return;
    this.error.set(null);
    try {
      this.status.set(await this.server.status());
    } catch {
      this.error.set(
        `Could not reach ${this.serverConfig.serverUrl()} to ask how it scans. Check Settings.`,
      );
    }
  }
}
