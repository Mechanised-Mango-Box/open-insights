import { Component, computed, inject, signal } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { DEFAULT_SERVER_URL, LOCAL_SERVER_URL, ServerConfigService } from './server-config.service';
import {
  PUBLIC_MAX_UPLOAD,
  PUBLIC_QUEUE_DEPTH,
  PUBLIC_UPLOADS_PER_HOUR,
  RELEASES_URL,
  ServerChoice,
} from './server-choice';

/**
 * Asked once per load, before the first click.
 *
 * Deliberately not a one-time decision written to localStorage: which server is
 * right changes with what you are doing that session - a couple of videos on
 * the shared box, a whole dataset on your own - and the cost of asking is one
 * Escape. Dismissing it changes nothing at all, which is what lets it be asked
 * every time without becoming a trap for someone already set up.
 */
@Component({
  selector: 'server-choice-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatRadioModule],
  template: `
    <h2 mat-dialog-title>Where should scanning run?</h2>

    <mat-dialog-content>
      <p class="lead">
        Only Scan needs a server. Import, Analysis and Export run in this browser either way.
      </p>

      <mat-radio-group [value]="selected()" (change)="selected.set($event.value)">
        <div class="option" (click)="selected.set('public')">
          <mat-radio-button value="public">The shared public server</mat-radio-button>
          <p>
            Nothing to install. It is shared and rate limited: your video uploads over the network,
            then queues behind everyone else's, with one worker per task. {{ maxUpload }} per file,
            {{ uploadsPerHour }} uploads an hour, and the queue turns work away past
            {{ queueDepth }} waiting jobs. Fine for trying this out; slow for a dataset.
          </p>
        </div>

        <div class="option" (click)="selected.set('local')">
          <mat-radio-button value="local">
            A server I run myself
            @if (customUrl(); as url) {
              <span class="current">— currently {{ url }}</span>
            }
          </mat-radio-button>
          <p>
            A single download — no Python, no setup. Videos stay on your machine and nothing waits
            behind other people.
            @if (customUrl()) {
              <span>This takes you to Settings, where the server above is already set.</span>
            } @else {
              <span
                >This takes you to Settings, pointed at <code>http://localhost:5000</code>.</span
              >
            }
            <a [href]="releasesUrl" target="_blank" rel="noopener">Get a release</a>
          </p>
        </div>
      </mat-radio-group>

      <p class="footnote">
        This browser is currently using <code>{{ serverConfig.serverUrl() }}</code
        >. You can change it any time in Settings.
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button type="button" (click)="decideLater()">Decide later</button>
      <button mat-raised-button color="primary" type="button" (click)="confirm()">Continue</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .lead {
        color: var(--mat-sys-on-surface-variant);
        margin: 0 0 16px;
      }
      mat-radio-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      /* The whole block selects, so the paragraph explaining an option is part
         of its hit target rather than dead text beside the button. Not a
         <label> - mat-radio-button renders its own, and nesting the two is
         invalid and makes a click on the outer one ambiguous. */
      .option {
        display: block;
        padding: 12px;
        border-radius: 12px;
        background: var(--mat-sys-surface-container);
        border: 1px solid var(--mat-sys-outline-variant);
        cursor: pointer;
      }
      .option p {
        /* Lines the prose up under the radio's label rather than its button. */
        margin: 4px 0 0 32px;
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
      }
      .current {
        color: var(--mat-sys-on-surface-variant);
      }
      /* Says what dismissing this leaves in place - the reason Escape is safe. */
      .footnote {
        margin: 16px 0 0;
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
      }
      code {
        font-family: monospace;
        background: var(--mat-sys-surface-container-high);
        border-radius: 4px;
        padding: 1px 5px;
      }
      a {
        color: var(--mat-sys-primary);
      }
    `,
  ],
})
export class ServerChoiceDialogComponent {
  private dialogRef = inject(MatDialogRef<ServerChoiceDialogComponent, ServerChoice | undefined>);
  protected serverConfig = inject(ServerConfigService);

  protected readonly releasesUrl = RELEASES_URL;
  protected readonly maxUpload = PUBLIC_MAX_UPLOAD;
  protected readonly uploadsPerHour = PUBLIC_UPLOADS_PER_HOUR;
  protected readonly queueDepth = PUBLIC_QUEUE_DEPTH;

  /**
   * Preselected to whatever this browser already does, so a returning user
   * reads a confirmation rather than a question they have answered before.
   */
  protected readonly selected = signal<ServerChoice>(
    this.serverConfig.serverUrl() === DEFAULT_SERVER_URL ? 'public' : 'local',
  );

  /**
   * The server they brought, when it is not the localhost this dialog would
   * otherwise offer to set. Naming it is what stops "Continue" reading as a
   * promise to move them - the service leaves such a URL alone, and the option
   * says so instead of silently doing nothing.
   */
  protected readonly customUrl = computed(() => {
    const url = this.serverConfig.serverUrl();
    return url === DEFAULT_SERVER_URL || url === LOCAL_SERVER_URL ? null : url;
  });

  /** Strictly nothing changes. Someone already pointed at their own server has
   * to be able to dismiss this without being moved back to the shared one. */
  protected decideLater(): void {
    this.dialogRef.close(undefined);
  }

  protected confirm(): void {
    const choice = this.selected();
    if (choice === 'public') {
      this.serverConfig.usePublicServer();
    } else {
      this.serverConfig.useLocalServer();
    }
    this.dialogRef.close(choice);
  }
}
