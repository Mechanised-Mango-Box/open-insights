import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { VideoTableComponent } from '../data-management/video-records/video-table.component';
import { VideoRecordsImport } from '../data-management/video-records/video-records-import.component';
import { ExportRecordsComponent } from '../data-management/video-records/export-records.component';
import { ScanActionsComponent } from '../data-management/video-records/scan-actions.component';
import { AnalysisComponent } from '../data-management/analysis/analysis.component';
import { RecommendPageComponent } from '../data-management/recommendation/recommend-page.component';
import { ServerSettingsComponent } from '../data-management/server-settings.component';
import { ProcessingModeBadgeComponent } from '../data-management/processing-mode-badge.component';
import { ServerChoiceDialogComponent } from '../data-management/server-choice-dialog.component';
import { ComputeConfigService } from '../data-management/compute-config.service';
import { SERVER_CHOICE_PROMPT, ServerChoice } from '../data-management/server-choice';
import { HomeComponent } from './home.component';
import { HOME, SETTINGS, VIEWS_WITH_RECORDS, ViewId, WORKFLOW } from './views';

/** Below this width the sidebar would leave too little room beside it, so it becomes a
    drawer. Repeated in the component's media query. */
const HANDSET_QUERY = '(max-width: 768px)';

@Component({
  selector: 'view-manager',
  template: `
    <mat-sidenav-container class="shell">
      <!-- Docked beside the content on a wide window; on a phone there is no room for
           that, so it becomes a drawer over the content, opened from the top bar. -->
      <mat-sidenav
        [mode]="isHandset() ? 'over' : 'side'"
        [opened]="!isHandset() || navOpen()"
        [disableClose]="!isHandset()"
        (openedChange)="isHandset() && navOpen.set($event)"
      >
        <nav class="sidebar">
          <button
            class="brand"
            [class.brand-active]="view() === home.id"
            (click)="go(home.id)"
            title="Overview and instructions"
          >
            <mat-icon>{{ home.icon }}</mat-icon>
            <span>Open Insights</span>
          </button>

          <mat-action-list class="steps">
            @for (step of workflow; track step.id) {
              <button mat-list-item [activated]="view() === step.id" (click)="go(step.id)">
                <mat-icon matListItemIcon>{{ step.icon }}</mat-icon>
                <span matListItemTitle>{{ step.label }}</span>
              </button>
            }
          </mat-action-list>

          <div class="sidebar-footer">
            <processing-mode-badge />

            <mat-action-list class="settings">
              <button mat-list-item [activated]="view() === settings.id" (click)="go(settings.id)">
                <mat-icon matListItemIcon>{{ settings.icon }}</mat-icon>
                <span matListItemTitle>{{ settings.label }}</span>
              </button>
            </mat-action-list>
          </div>
        </nav>
      </mat-sidenav>

      <mat-sidenav-content>
        @if (isHandset()) {
          <header class="topbar">
            <button mat-icon-button aria-label="Open navigation" (click)="navOpen.set(true)">
              <mat-icon>menu</mat-icon>
            </button>
            <span class="topbar-title">Open Insights</span>
          </header>
        }

        <main class="content">
          <header class="view-header">
            <h1>{{ activeView().label }}</h1>
            <p>{{ activeView().blurb }}</p>
          </header>

          @switch (view()) {
            @case ('home') {
              <home-overview (navigate)="go($event)" />
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
            @case ('recommend') {
              <!-- Deferred like Analysis: its tabs, model picker and card pull in
                   Material modules only this step uses. -->
              @defer (on idle) {
                <recommend-page />
              } @placeholder {
                <p>Loading recommendations…</p>
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
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .shell {
        height: 100%;
        /* The drawer's own surface and rounded corner are replaced by the sidebar's,
           so docked and drawn out it is the same panel. */
        --mat-sidenav-container-shape: 0;
        --mat-sidenav-container-divider-color: var(--mat-sys-outline-variant);
        --mat-sidenav-container-background-color: var(--mat-sys-surface-container);
        --mat-sidenav-content-background-color: var(--mat-sys-surface);
      }
      mat-sidenav {
        width: 232px;
      }
      /* Fills the drawer, which does the scrolling. */
      .sidebar {
        display: flex;
        flex-direction: column;
        min-height: 100%;
      }
      /* The app name doubles as the Home nav item, so it's a real button - styled as a
         title, but focusable and keyboard-activatable like the steps below it.
         It carries a surface and a border of its own because as bare text it lost to
         the steps underneath: they each have an icon, a ripple and an active indicator,
         and nothing up here said the app name could be clicked at all. */
      .brand {
        appearance: none;
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--mat-sys-surface-container-high);
        border: 1px solid var(--mat-sys-outline-variant);
        color: inherit;
        font: var(--mat-sys-title-medium);
        text-align: left;
        cursor: pointer;
        padding: 12px 16px;
        margin: 12px 8px;
        border-radius: 8px;
        transition:
          background 120ms ease,
          color 120ms ease;
      }
      .brand mat-icon {
        flex: 0 0 auto;
        color: var(--mat-sys-primary);
      }
      .brand:hover {
        background: var(--mat-sys-surface-container-highest);
      }
      /* Material gives the list items a focus affordance; a bare <button> has none. */
      .brand:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
      /* Primary rather than the steps' secondary-container: painting it the same colour
         as an activated step is what made Home read as just another step. */
      .brand-active {
        background: var(--mat-sys-primary-container);
        color: var(--mat-sys-on-primary-container);
        border-color: transparent;
      }
      .brand-active mat-icon {
        color: var(--mat-sys-on-primary-container);
      }
      /* Takes up the slack, which is what pins Settings to the bottom of the sidebar.
         The rule on top separates the app name from the workflow, mirroring the one
         above the footer. */
      .steps {
        flex: 1 1 auto;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }
      /* The badge and Settings are one block: the badge says where work goes,
         and the item under it is what changes that, so the rule goes round both
         rather than between them. */
      .sidebar-footer {
        flex: 0 0 auto;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }
      .sidebar-footer processing-mode-badge {
        display: block;
        padding: 12px 16px 4px;
      }
      /* mat-sidenav-content is the scroller, independent of the sidebar. */
      .content {
        padding: 24px 32px 48px;
      }
      /* Phone only: the one way back to the navigation once the sidebar becomes a
         drawer. Sticky so it is there without scrolling back up a long view. */
      .topbar {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: var(--mat-sys-surface-container);
        border-bottom: 1px solid var(--mat-sys-outline-variant);
      }
      .topbar-title {
        font: var(--mat-sys-title-medium);
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
      /* Must match HANDSET_QUERY. */
      @media (max-width: 768px) {
        .content {
          padding: 16px 16px 32px;
        }
        .view-header h1 {
          font: var(--mat-sys-title-large);
        }
      }
    `,
  ],
  imports: [
    MatListModule,
    MatSidenavModule,
    MatIconButton,
    MatIcon,
    HomeComponent,
    VideoTableComponent,
    VideoRecordsImport,
    ExportRecordsComponent,
    ScanActionsComponent,
    AnalysisComponent,
    RecommendPageComponent,
    ServerSettingsComponent,
    ProcessingModeBadgeComponent,
  ],
})
export class ViewManager {
  private dialog = inject(MatDialog);
  private computeConfig = inject(ComputeConfigService);
  private promptEnabled = inject(SERVER_CHOICE_PROMPT);

  readonly workflow = WORKFLOW;
  readonly settings = SETTINGS;
  readonly home = HOME;

  view = signal<ViewId>(HOME.id);

  private breakpoints = inject(BreakpointObserver);

  // Seeded from the current width so a phone never renders one frame docked.
  readonly isHandset = toSignal(
    this.breakpoints.observe(HANDSET_QUERY).pipe(map((state) => state.matches)),
    { initialValue: this.breakpoints.isMatched(HANDSET_QUERY) },
  );

  /** Whether the drawer is drawn out. Only means anything on a phone; docked, it is
      always open. */
  navOpen = signal(false);

  /** Every nav item goes through here, so picking one on a phone also puts the drawer
      away rather than leaving it covering the view just chosen. */
  go(id: ViewId): void {
    this.view.set(id);
    this.navOpen.set(false);
  }

  constructor() {
    // After the first render rather than during it: opening a dialog attaches a
    // view synchronously, and this shell renders the processing-mode badge off
    // the same server settings the dialog reads. Doing it inside the pass is
    // how that pair turns into ExpressionChangedAfterItHasBeenChecked.
    afterNextRender(() => this.askWhereWorkRuns());
  }

  /**
   * Asked once per load. There is exactly one ViewManager, so no flag is needed
   * to keep it to one - and none is stored, because the question is meant to be
   * asked again next time rather than settled forever.
   */
  private askWhereWorkRuns(): void {
    // Nothing to ask when no kind is going to a server at all. Note this is
    // stricter than "the experiment is on": one kind in the browser and one on
    // the server still leaves the server question live.
    if (!this.promptEnabled || !this.computeConfig.usesServer()) return;

    this.dialog
      .open(ServerChoiceDialogComponent, { width: 'min(560px, 92vw)' })
      .afterClosed()
      .subscribe((choice?: ServerChoice) => {
        // The dialog has already saved the choice; all that is left is to put
        // them where the URL and key it just set are visible and checkable.
        if (choice === 'local') this.view.set(this.settings.id);
      });
  }

  activeView = computed(
    () => [HOME, ...WORKFLOW, SETTINGS].find((entry) => entry.id === this.view()) ?? HOME,
  );

  showsRecords = computed(() => VIEWS_WITH_RECORDS.has(this.view()));
}
