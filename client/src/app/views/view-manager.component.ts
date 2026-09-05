import { Component, computed, signal } from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { MatIcon } from '@angular/material/icon';
import { VideoTableComponent } from '../data-management/video-records/video-table.component';
import { VideoRecordsImport } from '../data-management/video-records/video-records-import.component';
import { ExportRecordsComponent } from '../data-management/video-records/export-records.component';
import { ScanActionsComponent } from '../data-management/video-records/scan-actions.component';
import { AnalysisComponent } from '../data-management/analysis/analysis.component';
import { ServerSettingsComponent } from '../data-management/server-settings.component';
import { HomeComponent } from './home.component';
import { HOME, SETTINGS, VIEWS_WITH_RECORDS, ViewId, WORKFLOW } from './views';

@Component({
  selector: 'view-manager',
  template: `
    <div class="shell">
      <nav class="sidebar">
        <button
          class="brand"
          [class.brand-active]="view() === home.id"
          (click)="view.set(home.id)"
          title="Overview and instructions"
        >
          Open Insights
        </button>

        <mat-action-list class="steps">
          @for (step of workflow; track step.id) {
            <button mat-list-item [activated]="view() === step.id" (click)="view.set(step.id)">
              <mat-icon matListItemIcon>{{ step.icon }}</mat-icon>
              <span matListItemTitle>{{ step.label }}</span>
            </button>
          }
        </mat-action-list>

        <mat-action-list class="settings">
          <button
            mat-list-item
            [activated]="view() === settings.id"
            (click)="view.set(settings.id)"
          >
            <mat-icon matListItemIcon>{{ settings.icon }}</mat-icon>
            <span matListItemTitle>{{ settings.label }}</span>
          </button>
        </mat-action-list>
      </nav>

      <main class="content">
        <header class="view-header">
          <h1>{{ activeView().label }}</h1>
          <p>{{ activeView().blurb }}</p>
        </header>

        @switch (view()) {
          @case ('home') {
            <home-overview (navigate)="view.set($event)" />
          }
          @case ('import') {
            <video-records-import />
          }
          @case ('scan') {
            <scan-actions />
          }
          @case ('export') {
            <export-records />
          }
          @case ('analysis') {
            @defer (on idle) {
              <analysis />
            } @placeholder {
              <p>Loading analysis…</p>
            }
          }
          @case ('settings') {
            <server-settings />
          }
        }

        @if (showsRecords()) {
          <section class="records">
            <h2>Records</h2>
            <video-table />
          </section>
        }
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .shell {
        display: flex;
        height: 100%;
      }
      .sidebar {
        flex: 0 0 232px;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        background: var(--mat-sys-surface-container);
        border-right: 1px solid var(--mat-sys-outline-variant);
      }
      /* The app name doubles as the Home nav item, so it's a real button - styled as a
         title, but focusable and keyboard-activatable like the steps below it. */
      .brand {
        appearance: none;
        background: none;
        border: 0;
        color: inherit;
        font: var(--mat-sys-title-medium);
        text-align: left;
        cursor: pointer;
        padding: 12px 16px;
        margin: 12px 8px 4px;
        border-radius: 8px;
      }
      .brand:hover {
        background: var(--mat-sys-surface-container-high);
      }
      .brand-active {
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
      }
      /* Takes up the slack, which is what pins Settings to the bottom of the sidebar. */
      .steps {
        flex: 1 1 auto;
      }
      .settings {
        flex: 0 0 auto;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }
      .content {
        flex: 1 1 auto;
        /* Scrolls independently of the sidebar; 'auto' on both axes so a wide record
           table scrolls sideways in here rather than stretching the page. */
        overflow: auto;
        padding: 24px 32px 48px;
      }
      /* Ruled off so the view's name and blurb read as a header rather than as the first
         paragraph of whatever the view puts below it. */
      .view-header {
        margin: 0 0 20px;
        padding: 0 0 16px;
        border-bottom: 1px solid var(--mat-sys-outline-variant);
      }
      .view-header h1 {
        font: var(--mat-sys-headline-small);
        margin: 0 0 4px;
      }
      .view-header p {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
      }
      .records {
        margin-top: 32px;
      }
      .records h2 {
        font: var(--mat-sys-title-medium);
        margin: 0 0 8px;
      }
    `,
  ],
  imports: [
    MatListModule,
    MatIcon,
    HomeComponent,
    VideoTableComponent,
    VideoRecordsImport,
    ExportRecordsComponent,
    ScanActionsComponent,
    AnalysisComponent,
    ServerSettingsComponent,
  ],
})
export class ViewManager {
  readonly workflow = WORKFLOW;
  readonly settings = SETTINGS;
  readonly home = HOME;

  view = signal<ViewId>(HOME.id);

  activeView = computed(
    () => [HOME, ...WORKFLOW, SETTINGS].find((entry) => entry.id === this.view()) ?? HOME,
  );

  showsRecords = computed(() => VIEWS_WITH_RECORDS.has(this.view()));
}
