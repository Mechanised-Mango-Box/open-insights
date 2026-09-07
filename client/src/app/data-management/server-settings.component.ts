import { Component, computed, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ServerConfigService, DEFAULT_SERVER_URL } from './server-config.service';
import { ComputeConfigService, ComputeTarget } from './compute-config.service';
import { ComputeQueueService } from './local-compute/compute-queue.service';
import {
  DATASET_KINDS,
  DatasetKind,
  DatasetProvider,
  ProviderStatus,
} from './providers/dataset-provider';

/**
 * Two cards, in the order the settings depend on each other: which server to
 * talk to and whether it answers, then what is allowed to run somewhere else.
 *
 * The status check lives inside the server card rather than as a section of its
 * own - it reads the URL set directly above it, and reading that URL is half of
 * what it is for.
 */
@Component({
  selector: 'server-settings',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <div class="settings">
      <section class="card">
        <h2>Dataset Server</h2>
        <p class="lead">Which server this browser sends its work to. Saved in this browser only.</p>

        <div class="controls">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Server URL</mat-label>
            <input
              matInput
              [value]="draftUrl()"
              (input)="onInput($event)"
              placeholder="http://localhost:5000"
            />
          </mat-form-field>
          <button mat-stroked-button type="button" (click)="useLocal()">Use local</button>
          <button mat-raised-button color="primary" type="button" (click)="save()">Save</button>
        </div>
        <p class="muted">Active: {{ serverConfig.serverUrl() }}</p>

        <h3>Status</h3>
        <p class="lead">
          How much work the active server has queued, and how many of its workers are on each task.
          Reads the saved URL above, so it doubles as a reachability check.
        </p>
        <div class="controls">
          <button mat-stroked-button type="button" [disabled]="checking()" (click)="checkStatus()">
            {{ checking() ? 'Checking…' : 'Check status' }}
          </button>
          @if (status(); as report) {
            <span class="status-summary">
              {{ report.queue.queued }} queued · {{ report.queue.running }} running ·
              {{ report.queue.failed }} failed — {{ report.workers.busy }} of
              {{ report.workers.total }} workers busy
            </span>
          }
        </div>

        @if (error(); as message) {
          <p class="status-error">Could not reach {{ serverConfig.serverUrl() }} — {{ message }}</p>
        }

        @if (status()) {
          <table class="settings-table numeric">
            <thead>
              <tr>
                <th>Task</th>
                <th>Queued</th>
                <th>Running</th>
                <th>Failed</th>
                <th>Workers busy</th>
                <th>Awaiting worker</th>
              </tr>
            </thead>
            <tbody>
              @for (row of kindRows(); track row[0]) {
                <tr>
                  <td>{{ row[0] }}</td>
                  <td>{{ row[1].jobs.queued }}</td>
                  <td>{{ row[1].jobs.running }}</td>
                  <td>{{ row[1].jobs.failed }}</td>
                  <td>{{ row[1].workers.busy }} of {{ row[1].workers.total }}</td>
                  <td>{{ row[1].workers.awaiting_worker }}</td>
                </tr>
              }
            </tbody>
          </table>
          <p class="muted">
            A task showing more running than busy is a job whose worker was lost; the server
            reclaims it once its lease expires.
          </p>
        }
      </section>

      <section class="card">
        <h2>Where Work Runs</h2>
        <p class="lead">
          Work runs on the dataset server above. Running it in this browser instead is experimental.
        </p>

        <div class="experimental">
          <h3>Experimental: run the work in this browser</h3>
          <p class="muted">
            Keeps your video on this machine and needs no server. It is
            <strong>much slower</strong> — the server manages around 15× realtime for scene stats
            across all its cores, where a browser has one thread and no SIMD — so a full batch can
            take many hours. It also accepts less: MP4 and MOV only for scene stats, and
            transcription needs WebGPU.
          </p>
          <p class="muted">
            Results are stamped as coming from a different producer, so anything already computed by
            the server reads as not started, and the two are never mixed into one analysis. None of
            it has been checked against known-good results yet, so treat what it produces as
            provisional.
          </p>
          <div class="controls">
            @if (computeConfig.experimental()) {
              <button mat-stroked-button type="button" (click)="setExperimental(false)">
                Disable browser compute
              </button>
              <span class="muted">Enabled — choose per task below.</span>
            } @else {
              <button mat-stroked-button type="button" (click)="setExperimental(true)">
                I understand — enable browser compute
              </button>
            }
          </div>
        </div>

        <table class="settings-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>This browser</th>
              <th>Server</th>
            </tr>
          </thead>
          <tbody>
            @for (kind of kinds; track kind) {
              <tr class="no-rule">
                <td>{{ kindLabels[kind] }}</td>
                <td>
                  @if (!computeConfig.experimental()) {
                    <span class="muted">Enable above to use this</span>
                  } @else if (localAvailable(kind)) {
                    <button
                      mat-stroked-button
                      type="button"
                      [disabled]="computeConfig.targetFor(kind) === 'local'"
                      (click)="setTarget(kind, 'local')"
                    >
                      This browser
                    </button>
                  } @else {
                    <span class="muted">Not available in this browser</span>
                  }
                </td>
                <td>
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="computeConfig.targetFor(kind) === 'server'"
                    (click)="setTarget(kind, 'server')"
                  >
                    Server
                  </button>
                </td>
              </tr>
              <tr>
                <td colspan="3" class="kind-note muted">{{ kindNotes[kind] }}</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    </div>
  `,
  styles: [
    `
      .settings {
        display: flex;
        flex-direction: column;
        gap: 24px;
        max-width: 80ch;
      }
      .card {
        background: var(--mat-sys-surface-container);
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 12px;
        padding: 20px 24px;
      }
      h2 {
        font: var(--mat-sys-title-medium);
        margin: 0 0 4px;
      }
      h3 {
        font: var(--mat-sys-title-small);
        margin: 24px 0 4px;
      }
      .experimental h3 {
        margin-top: 0;
      }
      .lead {
        color: var(--mat-sys-on-surface-variant);
        margin: 0 0 16px;
      }
      /* One class for every piece of secondary text on the page - these were
         four near-identical rules that had already started to drift apart. */
      .muted {
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
      }
      .controls {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
      }
      .controls mat-form-field {
        width: 320px;
      }
      .status-summary {
        font: var(--mat-sys-title-small);
      }
      .status-error {
        color: var(--mat-sys-error);
      }
      /* The experiment is bordered off rather than merely worded differently:
         the warning has to survive being skim-read. */
      .experimental {
        border: 1px solid var(--mat-sys-outline-variant);
        border-left: 4px solid var(--mat-sys-error);
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 20px;
      }
      /* Plain tables rather than MatTable: these are a handful of static rows
         with no sorting, filtering or selection, so a MatTableDataSource would
         be scaffolding around nothing. */
      .settings-table {
        border-collapse: collapse;
        width: 100%;
      }
      .settings-table th,
      .settings-table td {
        text-align: left;
        padding: 6px 12px 6px 0;
        border-bottom: 1px solid var(--mat-sys-outline-variant);
      }
      .settings-table th {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      /* Counts read better right-aligned, but the task they belong to does not. */
      .settings-table.numeric th:not(:first-child),
      .settings-table.numeric td:not(:first-child) {
        text-align: right;
      }
      /* A task and its note are one entry, so only the note carries the rule. */
      .settings-table tr.no-rule td {
        border-bottom: none;
      }
      .kind-note {
        padding-bottom: 12px;
        max-width: 60ch;
      }
    `,
  ],
})
export class ServerSettingsComponent {
  serverConfig = inject(ServerConfigService);
  computeConfig = inject(ComputeConfigService);
  private provider = inject(DatasetProvider);
  private queue = inject(ComputeQueueService);

  // Widened from the const tuple: the template's @for infers `unknown` from a
  // readonly tuple, but reads the union correctly off an array type.
  protected readonly kinds: readonly DatasetKind[] = DATASET_KINDS;
  protected readonly kindLabels: Record<DatasetKind, string> = {
    transcript: 'Transcript',
    scene_stats: 'Scene stats',
  };

  /** What changes by moving a kind into the browser. Both of these alter the
   * numbers, not just where they are computed, so neither should be discovered
   * after a batch has run. */
  protected readonly kindNotes: Record<DatasetKind, string> = {
    transcript:
      'In this browser: Whisper tiny.en, needing WebGPU and a one-time ~75MB model download. ' +
      'It is a much smaller model than the server runs, so word counts - and the speaking-speed ' +
      'feature built on them - will shift. Transcripts already held from a server were made by a ' +
      'different model and will read as not started.',
    scene_stats:
      'In this browser: WebCodecs, MP4 and MOV only (not .mkv or .webm). Same threshold as the ' +
      'server, but frames come through a different decoder, so counts may differ slightly. ' +
      'Scene stats already held from a server will read as not started.',
  };

  /** A kind can only be sent to this browser once something here knows how to
   * compute it - offering the switch before then would just produce errors. */
  protected localAvailable(kind: DatasetKind): boolean {
    return this.queue.computerFor(kind) !== undefined;
  }

  protected setTarget(kind: DatasetKind, target: ComputeTarget): void {
    this.computeConfig.setTarget(kind, target);
  }

  protected setExperimental(enabled: boolean): void {
    this.computeConfig.setExperimental(enabled);
  }

  draftUrl = signal(this.serverConfig.serverUrl());

  status = signal<ProviderStatus | null>(null);
  checking = signal(false);
  error = signal<string | null>(null);

  /** Object.entries over `kinds` rather than a hardcoded transcript/scene_stats pair,
   * so a dataset kind added to the server shows up here on its own. */
  kindRows = computed(() => Object.entries(this.status()?.kinds ?? {}));

  onInput(event: Event): void {
    this.draftUrl.set((event.target as HTMLInputElement).value);
  }

  useLocal(): void {
    this.draftUrl.set(DEFAULT_SERVER_URL);
  }

  save(): void {
    this.serverConfig.setServerUrl(this.draftUrl());
  }

  /** Manual refresh, one fetch per press. No polling, so there is no interval to tear
   * down when the user leaves this view - and nothing keeps hitting a server that is
   * down after the one press that found out. */
  async checkStatus(): Promise<void> {
    this.checking.set(true);
    this.error.set(null);
    try {
      this.status.set(await this.provider.status());
    } catch (error) {
      // Whatever the provider could not do, it rejected with - an unreachable or
      // CORS-blocked server still arrives as an Error carrying a usable message.
      this.error.set(error instanceof Error ? error.message : String(error));
      // Cleared rather than left on screen: counts from a server that just failed to
      // answer are of unknown age, and reading them as current is the whole risk.
      this.status.set(null);
    } finally {
      this.checking.set(false);
    }
  }
}
