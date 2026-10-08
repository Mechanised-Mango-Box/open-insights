import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  ServerConfigService,
  LOCAL_SERVER_URL,
  DEFAULT_SERVER_URL,
  DEFAULT_API_KEY,
} from './server-config.service';
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
/**
 * The one failure a status 0 cannot explain but we can: a page served over
 * https cannot reach an http:// server, and the browser blocks it as mixed
 * content before a request is made. localhost is the exception - it counts as
 * a trustworthy origin - which is exactly why a LAN address looks identical to
 * the user and fails anyway.
 */
function mixedContentHint(url: string): string {
  try {
    const target = new URL(url);
    const isLoopback =
      target.hostname === 'localhost' ||
      target.hostname === '127.0.0.1' ||
      target.hostname === '[::1]';
    if (location.protocol === 'https:' && target.protocol === 'http:' && !isLoopback) {
      return ' - an http:// server other than localhost cannot be reached from this https page';
    }
  } catch {
    // Not a URL we can parse; the generic reason above is all there is to say.
  }
  return '';
}

/** Turns whatever a provider rejected with into something a person can act on. */
function describeRequestFailure(error: unknown, url: string): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return `no response (unreachable, DNS, TLS or blocked by CORS)${mixedContentHint(url)}`;
    }
    if (error.status === 401 || error.status === 403) {
      return `${error.status} - the server refused this API key`;
    }
    if (error.status === 429) {
      return '429 - rate limited; the public key has a per-hour cap';
    }
    return `${error.status} ${error.statusText}`.trim();
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

@Component({
  selector: 'server-settings',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, MatIcon],
  template: `
    <div class="view-stack">
      <section class="card">
        <h2>Dataset Server</h2>
        <p class="card-lead">
          Which server this browser sends its work to, and the key it sends. Saved in this browser
          only.
        </p>

        <div class="actions">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Server URL</mat-label>
            <input
              matInput
              [value]="draftUrl()"
              (input)="onInput($event)"
              placeholder="http://localhost:5000"
            />
          </mat-form-field>
          <button mat-stroked-button type="button" (click)="usePublic()">
            <mat-icon>public</mat-icon>
            Use Public
          </button>
          <button mat-stroked-button type="button" (click)="useLocal()">
            <mat-icon>computer</mat-icon>
            Use Local
          </button>
        </div>

        <h3>Access key</h3>
        <p class="card-lead">
          Sent with every request to the server above. The shared key the app ships with is rate
          limited — it is published in this page, so it is friction against abuse rather than a
          secret. If you run the server yourself, paste its private key here to lift those limits,
          or clear this box entirely for a server started with no keys configured. Use Public and
          Use Local fill this in for you.
        </p>
        <div class="actions">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>API key</mat-label>
            <input matInput [value]="draftKey()" (input)="onKeyInput($event)" />
          </mat-form-field>
          <button mat-stroked-button type="button" (click)="useSharedKey()">
            <mat-icon>key</mat-icon>
            Use Shared Key
          </button>
        </div>

        <div class="actions save-row">
          <button
            mat-raised-button
            color="primary"
            type="button"
            [disabled]="!dirty()"
            (click)="save()"
          >
            <mat-icon>save</mat-icon>
            Save
          </button>
          <p class="action-status">
            Active: {{ serverConfig.serverUrl() }} ·
            {{ serverConfig.apiKey() ? 'a key is set' : 'no key' }}
            @if (dirty()) {
              · unsaved changes
            }
          </p>
        </div>

        <h3>Status</h3>
        <p class="card-lead">
          How much work the active server has queued, and how many of its workers are on each task.
          Reads the saved URL above, so it doubles as a reachability check.
        </p>
        <div class="actions">
          <button mat-stroked-button type="button" [disabled]="checking()" (click)="checkStatus()">
            <mat-icon>monitor_heart</mat-icon>
            {{ checking() ? 'Checking…' : 'Check Status' }}
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
          <p class="action-hint">
            A task showing more running than busy is a job whose worker was lost; the server
            reclaims it once its lease expires.
          </p>
        }
      </section>

      <section class="card">
        <h2>Where Work Runs</h2>
        <p class="card-lead">
          Work runs on the dataset server above. Running it in this browser instead is experimental.
        </p>

        <div class="experimental">
          <h3>Experimental: run the work in this browser</h3>
          <p class="action-hint">
            Keeps your video on this machine and needs no server. It is
            <strong>much slower</strong> — the server manages around 15× realtime for scene stats
            across all its cores, where a browser has one thread and no SIMD — so a full batch can
            take many hours. It also accepts less: MP4 and MOV only for scene stats, and
            transcription needs WebGPU.
          </p>
          <p class="action-hint">
            Results are stamped as coming from a different producer, so anything already computed by
            the server reads as not started, and the two are never mixed into one analysis. None of
            it has been checked against known-good results yet, so treat what it produces as
            provisional.
          </p>
          <div class="actions">
            @if (computeConfig.experimental()) {
              <button mat-stroked-button type="button" (click)="setExperimental(false)">
                <mat-icon>block</mat-icon>
                Disable Browser Compute
              </button>
              <span class="action-status">Enabled — choose per task below.</span>
            } @else {
              <button mat-stroked-button type="button" (click)="setExperimental(true)">
                <mat-icon>science</mat-icon>
                I Understand — Enable Browser Compute
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
                    <span class="action-hint">Enable above to use this</span>
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
                    <span class="action-hint">Not available in this browser</span>
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
                <td colspan="3" class="kind-note action-hint">{{ kindNotes[kind] }}</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    </div>
  `,
  styles: [
    `
      .experimental h3 {
        margin-top: 0;
      }
      .experimental .action-hint {
        margin-bottom: 8px;
      }
      .save-row {
        margin-top: 16px;
      }
      .actions mat-form-field {
        width: min(320px, 100%);
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
      /* Six columns of counts do not fit a phone; the table scrolls within the card. */
      @media (max-width: 600px) {
        .settings-table {
          display: block;
          overflow-x: auto;
        }
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
    text_stats: 'Screen text',
    audio_stats: 'Audio stats',
  };

  /** What changes by moving a kind into the browser. Both of these alter the
   * numbers, not just where they are computed, so neither should be discovered
   * after a batch has run. */
  protected readonly kindNotes: Record<DatasetKind, string> = {
    transcript:
      'In this browser: Whisper tiny.en, needing WebGPU and a one-time ~75MB model download. ' +
      'It is a much smaller model than the server runs, so word counts - and the word count, ' +
      'speaking speed and pace variation features built on them - will shift. Transcripts already held from a server were made by a ' +
      'different model and will read as not started.',
    scene_stats:
      'In this browser: WebCodecs, MP4 and MOV only (not .mkv or .webm). Same threshold as the ' +
      'server, but frames come through a different decoder, so counts may differ slightly. ' +
      'Scene stats already held from a server will read as not started.',
    text_stats:
      'Server only: OCR (RapidOCR) has no browser implementation, so this always runs on the server.',
    audio_stats:
      'Server only: speech detection (Silero VAD) and pitch tracking (Praat) have no browser ' +
      'implementation, so this always runs on the server.',
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
  draftKey = signal(this.serverConfig.apiKey());

  status = signal<ProviderStatus | null>(null);
  checking = signal(false);
  error = signal<string | null>(null);

  /** Object.entries over `kinds` rather than a hardcoded transcript/scene_stats pair,
   * so a dataset kind added to the server shows up here on its own. */
  kindRows = computed(() => Object.entries(this.status()?.kinds ?? {}));

  onInput(event: Event): void {
    this.draftUrl.set((event.target as HTMLInputElement).value);
  }

  /**
   * Both of these stage the URL *and* the key, because the two belong together:
   * a server started with no keys wants no X-API-Key header at all, and the
   * shared key is meaningless anywhere but the public box. Leaving the key
   * behind was how "Use local" used to hand a self-run server a credential its
   * owner never set - harmless against a keyless server, a 403 against one with
   * keys configured.
   *
   * Drafts only, like everything else in this card: Save is what commits.
   */
  usePublic(): void {
    this.draftUrl.set(DEFAULT_SERVER_URL);
    this.draftKey.set(DEFAULT_API_KEY);
  }

  useLocal(): void {
    this.draftUrl.set(LOCAL_SERVER_URL);
    this.draftKey.set('');
  }

  /** Whether either box differs from what is saved, so Save says when it has
   * something to do. */
  dirty = computed(
    () =>
      this.draftUrl().trim().replace(/\/+$/, '') !== this.serverConfig.serverUrl() ||
      this.draftKey().trim() !== this.serverConfig.apiKey(),
  );

  /** Commits the URL and the key together, for the reason above: Use Public and
   * Use Local stage both, and saving one without the other is how a self-run
   * server used to be sent the shared key. */
  save(): void {
    this.serverConfig.setServerUrl(this.draftUrl());
    this.serverConfig.setApiKey(this.draftKey());
  }

  onKeyInput(event: Event): void {
    this.draftKey.set((event.target as HTMLInputElement).value);
  }

  useSharedKey(): void {
    this.draftKey.set(DEFAULT_API_KEY);
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
      // HttpClient rejects with HttpErrorResponse, which is not an Error, so the
      // generic String(error) below renders it as "[object Object]" and hides the
      // one thing worth knowing. status 0 is the browser refusing to hand over a
      // reason - unreachable, DNS, TLS or a CORS block all look identical here.
      this.error.set(describeRequestFailure(error, this.serverConfig.serverUrl()));
      // Cleared rather than left on screen: counts from a server that just failed to
      // answer are of unknown age, and reading them as current is the whole risk.
      this.status.set(null);
    } finally {
      this.checking.set(false);
    }
  }
}
