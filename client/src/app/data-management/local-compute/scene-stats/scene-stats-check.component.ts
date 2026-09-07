import { Component, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  SCENE_STATS_PRODUCER_LOCAL,
  measureSceneStats,
  supportsSceneStats,
} from './scene-stats.computer';
import type { SceneStatsTimings } from './scene-stats.worker';

type CheckResult = {
  name: string;
  duration_secs: number;
  scenes: number;
  timings: SceneStatsTimings;
};

/**
 * Runs one video through the local scene-stats path and prints what it got.
 *
 * Exists because the decode path cannot be unit tested - jsdom has no video
 * decoder - so the only way to know it agrees with the server is to run a file
 * whose answer is already known and compare. The counting arithmetic either
 * side of it is covered in scene-metrics.spec.ts.
 *
 * Deliberately bypasses the queue and the result cache: this is a measurement,
 * and it should neither wait behind a scan nor answer from something computed
 * earlier.
 */
@Component({
  selector: 'scene-stats-check',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    @if (available) {
      <h2>Check Scene Stats</h2>
      <p>
        Runs one video through this browser's scene-stats path and reports what it measured, without
        saving it. Use it to compare against a result you already trust.
      </p>
      <input #picker type="file" accept="video/*" hidden (change)="run($event)" />
      <button mat-stroked-button type="button" [disabled]="running()" (click)="picker.click()">
        {{ running() ? 'Measuring…' : 'Choose a video' }}
      </button>

      @if (error(); as message) {
        <p class="status-error">{{ message }}</p>
      }

      @if (result(); as measured) {
        <table class="status-table">
          <tbody>
            <tr>
              <td>File</td>
              <td>{{ measured.name }}</td>
            </tr>
            <tr>
              <td>duration_secs</td>
              <td>{{ measured.duration_secs }}</td>
            </tr>
            <tr>
              <td>scenes</td>
              <td>{{ measured.scenes }}</td>
            </tr>
            <tr>
              <td>Frames</td>
              <td>{{ measured.timings.frames }}</td>
            </tr>
            <tr>
              <td>Took</td>
              <td>{{ measured.timings.total_secs.toFixed(1) }}s</td>
            </tr>
            <tr>
              <td>&nbsp;&nbsp;frame readback</td>
              <td>{{ measured.timings.copy_secs.toFixed(1) }}s</td>
            </tr>
            <tr>
              <td>&nbsp;&nbsp;greyscale + diff</td>
              <td>{{ measured.timings.pixels_secs.toFixed(1) }}s</td>
            </tr>
            <tr>
              <td>&nbsp;&nbsp;demux + decode</td>
              <td>{{ measured.timings.other_secs.toFixed(1) }}s</td>
            </tr>
            <tr>
              <td>producer</td>
              <td>{{ producer }}</td>
            </tr>
          </tbody>
        </table>
      }
    } @else {
      <h2>Check Scene Stats</h2>
      <p class="status-note">
        This browser has no WebCodecs video decoder, so scene stats cannot run here.
      </p>
    }
  `,
  styles: [
    `
      .status-error {
        color: var(--mat-sys-error);
      }
      .status-note {
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
      }
      .status-table {
        border-collapse: collapse;
      }
      .status-table td {
        padding: 4px 12px 4px 0;
        border-bottom: 1px solid var(--mat-sys-outline-variant);
      }
      .status-table td:first-child {
        color: var(--mat-sys-on-surface-variant);
      }
    `,
  ],
})
export class SceneStatsCheckComponent {
  protected readonly available = supportsSceneStats();
  protected readonly producer = SCENE_STATS_PRODUCER_LOCAL;

  protected running = signal(false);
  protected result = signal<CheckResult | null>(null);
  protected error = signal<string | null>(null);

  protected async run(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so picking the same file again re-runs
    if (!file) return;

    this.running.set(true);
    this.error.set(null);
    this.result.set(null);

    try {
      const { result, timings } = await measureSceneStats(file);
      this.result.set({
        name: file.name,
        duration_secs: result.duration_secs,
        scenes: result.scenes,
        timings,
      });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.running.set(false);
    }
  }
}
