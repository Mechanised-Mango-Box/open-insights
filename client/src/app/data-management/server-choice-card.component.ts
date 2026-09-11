import { Component, computed, inject, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ViewId } from '../views/views';
import { DEFAULT_SERVER_URL, ServerConfigService } from './server-config.service';
import {
  PUBLIC_MAX_UPLOAD,
  PUBLIC_QUEUE_DEPTH,
  PUBLIC_UPLOADS_PER_HOUR,
  RELEASES_URL,
} from './server-choice';

/**
 * The two ways to get scanning done, side by side on the Overview.
 *
 * The dialog that opens on load asks the same question, but it is dismissed in
 * a second and never seen again that session. This is where the answer stays
 * readable - and where someone who chose "decide later" lands.
 */
@Component({
  selector: 'server-choice-card',
  standalone: true,
  imports: [MatIcon, MatButtonModule],
  template: `
    <section class="choice">
      <div class="intro">
        <mat-icon>dns</mat-icon>
        <div>
          <h2>Where the scanning happens</h2>
          <p>
            Scan is the only step that needs a server. Import, Analysis and Export run in this
            browser, on files that never leave it.
          </p>
        </div>
      </div>

      <div class="options">
        <div class="option" [class.in-use]="onPublic()">
          <div class="option-head">
            <h3>The shared public server</h3>
            @if (onPublic()) {
              <span class="tag">In use now</span>
            }
          </div>
          <p>
            Nothing to install, and it is what this browser uses unless you change it. It is one box
            shared with everyone else on this site: one transcription worker and one scene-stats
            worker, so your videos wait behind theirs. Each video is uploaded over your connection
            before any work starts — {{ maxUpload }} per file, {{ uploadsPerHour }} uploads an hour,
            and new jobs are refused once {{ queueDepth }} are already waiting.
          </p>
          <p class="verdict">Fine for a few videos; slow for a dataset.</p>
          @if (!onPublic()) {
            <button mat-stroked-button type="button" (click)="usePublic()">Use this server</button>
          }
        </div>

        <div class="option" [class.in-use]="!onPublic()">
          <div class="option-head">
            <h3>A server you run yourself</h3>
            @if (!onPublic()) {
              <span class="tag">In use now</span>
            }
          </div>
          <p>
            One file, no Python and no pip — the transcription weights are inside it. Run it and
            point <button class="jump" (click)="navigate.emit('settings')">Settings</button> at
            <code>http://localhost:5000</code>. Your videos never leave the machine, nothing queues
            behind anyone else, and none of the caps above apply.
          </p>
          <p class="verdict">It goes as fast as that machine does.</p>
          <div class="option-actions">
            <a class="download" [href]="releasesUrl" target="_blank" rel="noopener">
              <mat-icon>download</mat-icon>
              Download a release
            </a>
            @if (onPublic()) {
              <button mat-stroked-button type="button" (click)="useLocal()">Use this server</button>
            }
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .choice {
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 12px;
        padding: 16px;
      }
      /* Same icon-in-a-fixed-column shape as the callout below it, so the two
         blocks on this page line their text up with each other. */
      .intro {
        display: grid;
        grid-template-columns: 20px 1fr;
        gap: 10px;
        align-items: start;
        margin-bottom: 16px;
      }
      h2 {
        font: var(--mat-sys-title-medium);
        margin: 0 0 4px;
      }
      h3 {
        font: var(--mat-sys-title-small);
        margin: 0;
      }
      p {
        margin: 0 0 8px;
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
      }
      /* Wider than the step cards: these hold a paragraph each, and at 170px the
         text turns into a column of two-word lines. */
      .options {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }
      .option {
        padding: 12px;
        border-radius: 12px;
        background: var(--mat-sys-surface-container);
        border: 1px solid var(--mat-sys-outline-variant);
      }
      /* Which one is live is the first thing to read off this card, so it is
         marked on the panel itself and not only by the tag. */
      .option.in-use {
        border-color: var(--mat-sys-primary);
      }
      .option-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .tag {
        font: var(--mat-sys-label-small);
        color: var(--mat-sys-on-secondary-container);
        background: var(--mat-sys-secondary-container);
        border-radius: 999px;
        padding: 2px 8px;
        white-space: nowrap;
      }
      /* The one-line summary each panel is really making - kept in the body
         colour so it lands after the qualifications rather than before them. */
      .verdict {
        color: var(--mat-sys-on-surface);
      }
      /* The download link and the switch sit on one row where both are shown,
         and wrap rather than squeeze when the panels narrow. */
      .option-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .download {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font: var(--mat-sys-label-large);
        color: var(--mat-sys-primary);
        text-decoration: none;
      }
      .download:hover {
        text-decoration: underline;
      }
      /* A step name that reads as part of the sentence but jumps to that step. */
      .jump {
        appearance: none;
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        color: var(--mat-sys-primary);
        text-decoration: underline;
        cursor: pointer;
      }
      code {
        font-family: monospace;
        background: var(--mat-sys-surface-container-high);
        border-radius: 4px;
        padding: 1px 5px;
      }
      /* mat-icon's host box is a fixed 24px square, so the size has to be set on
         all three properties at once or the glyph outgrows its box. */
      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    `,
  ],
})
export class ServerChoiceCardComponent {
  private serverConfig = inject(ServerConfigService);

  protected readonly releasesUrl = RELEASES_URL;
  protected readonly maxUpload = PUBLIC_MAX_UPLOAD;
  protected readonly uploadsPerHour = PUBLIC_UPLOADS_PER_HOUR;
  protected readonly queueDepth = PUBLIC_QUEUE_DEPTH;

  /** Anything that is not the URL we ship counts as a server the user brought
   * themselves, on the same basis as the processing-mode badge. */
  protected readonly onPublic = computed(
    () => this.serverConfig.serverUrl() === DEFAULT_SERVER_URL,
  );

  navigate = output<ViewId>();

  /**
   * Only the panel that is *not* in use offers a button, so there is never a
   * disabled control or one whose guard would quietly no-op behind it.
   */
  protected usePublic(): void {
    this.serverConfig.usePublicServer();
  }

  /** Switches, then goes where it can be checked - the same reason the dialog
   * lands on Settings, since a local server nobody has started yet is the
   * likeliest next problem. */
  protected useLocal(): void {
    this.serverConfig.useLocalServer();
    this.navigate.emit('settings');
  }
}
