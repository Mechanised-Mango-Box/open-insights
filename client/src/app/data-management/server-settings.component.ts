import { Component, computed, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ServerConfigService, DEFAULT_SERVER_URL } from './server-config.service';
import { DatasetServerService, ServerStatus } from './dataset-server.service';

@Component({
  selector: 'server-settings',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <div class="server-settings">
      <h2>Dataset Server</h2>
      <p>Choose which dataset-server this browser talks to. Saved only in this browser.</p>
      <mat-form-field>
        <mat-label>Server URL</mat-label>
        <input
          matInput
          [value]="draftUrl()"
          (input)="onInput($event)"
          placeholder="http://localhost:5000"
        />
      </mat-form-field>
      <button mat-stroked-button type="button" (click)="useLocal()">Use Local</button>
      <button mat-raised-button color="primary" type="button" (click)="save()">Save</button>
      <p>Active: {{ serverConfig.serverUrl() }}</p>

      <h2>Server Status</h2>
      <p>
        How much work the active server has queued, and how many of its workers are on each task.
        Reads the saved server above, so it also confirms that URL is reachable.
      </p>
      <button mat-stroked-button type="button" [disabled]="checking()" (click)="checkStatus()">
        {{ checking() ? 'Checking…' : 'Check Server Status' }}
      </button>

      @if (error(); as message) {
        <p class="status-error">Could not reach {{ serverConfig.serverUrl() }} — {{ message }}</p>
      }

      @if (status(); as report) {
        <p class="status-summary">
          {{ report.queue.queued }} queued · {{ report.queue.running }} running ·
          {{ report.queue.failed }} failed — {{ report.workers.busy }} of
          {{ report.workers.total }} workers busy
        </p>
        <table class="status-table">
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
        <p class="status-note">
          A task showing more running than busy is a job whose worker was lost; the server reclaims
          it once its lease expires.
        </p>
      }
    </div>
  `,
  styles: [
    `
      .status-summary {
        font: var(--mat-sys-title-small);
      }
      .status-error {
        color: var(--mat-sys-error);
      }
      /* A plain table rather than MatTable: this is a handful of static rows with no
         sorting, filtering or selection, so a MatTableDataSource would be scaffolding
         around nothing. */
      .status-table {
        border-collapse: collapse;
      }
      .status-table th,
      .status-table td {
        text-align: right;
        padding: 4px 12px;
        border-bottom: 1px solid var(--mat-sys-outline-variant);
      }
      .status-table th:first-child,
      .status-table td:first-child {
        text-align: left;
      }
      .status-table th {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      .status-note {
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
      }
    `,
  ],
})
export class ServerSettingsComponent {
  serverConfig = inject(ServerConfigService);
  private datasetServer = inject(DatasetServerService);

  draftUrl = signal(this.serverConfig.serverUrl());

  status = signal<ServerStatus | null>(null);
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
      this.status.set(await this.datasetServer.getServerStatus());
    } catch (error) {
      // Same idiom as DatasetActionsService: an HttpErrorResponse from an unreachable
      // or CORS-blocked server is still an Error carrying a usable message.
      this.error.set(error instanceof Error ? error.message : String(error));
      // Cleared rather than left on screen: counts from a server that just failed to
      // answer are of unknown age, and reading them as current is the whole risk.
      this.status.set(null);
    } finally {
      this.checking.set(false);
    }
  }
}
