import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../app.config';
import { ViewManager } from '../views/view-manager.component';
import { ComputeConfigService } from './compute-config.service';
import { DEFAULT_SERVER_URL, LOCAL_SERVER_URL, ServerConfigService } from './server-config.service';

/**
 * Driven through the real shell rather than the dialog alone: what is worth
 * pinning is that it opens on load at all, and that choosing your own server
 * lands you somewhere you can check it - neither of which a dialog tested in
 * isolation would notice losing.
 */
describe('the server-choice prompt on load', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<ViewManager>>;
  let server: ServerConfigService;
  let compute: ComputeConfigService;

  const dialog = () => document.querySelector('server-choice-dialog');
  const button = (text: string) =>
    [...document.querySelectorAll('button')].find((el) =>
      el.textContent?.trim().startsWith(text),
    ) as HTMLButtonElement;
  const radio = (value: string) =>
    document.querySelector(`input[type="radio"][value="${value}"]`) as HTMLInputElement;
  const heading = () => fixture.nativeElement.querySelector('h1')?.textContent?.trim();

  /** The shell opens the dialog from its first render, so nothing can be set up
   * after createComponent - each test says what it wants, then renders. */
  async function render(): Promise<void> {
    fixture = TestBed.createComponent(ViewManager);
    await fixture.whenStable();
  }

  /**
   * Presses one of the dialog's buttons and waits for the close to land.
   * afterClosed only emits once the exit animation has run, and the navigation
   * this is checking hangs off that - so asserting on whenStable alone reads
   * the view one frame too early.
   */
  async function press(text: string): Promise<void> {
    const closed = firstValueFrom(TestBed.inject(MatDialog).openDialogs[0].afterClosed());
    button(text).click();
    await closed;
    await fixture.whenStable();
  }

  beforeEach(async () => {
    globalThis.localStorage?.clear();

    await TestBed.configureTestingModule({
      imports: [ViewManager],
      providers: [...appConfig.providers],
    }).compileComponents();

    server = TestBed.inject(ServerConfigService);
    compute = TestBed.inject(ComputeConfigService);
  });

  afterEach(() => {
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  it('asks where work should run, before anything has been clicked', async () => {
    await render();
    expect(dialog()).not.toBeNull();
  });

  it('commits the local server and lands on Settings, where it can be checked', async () => {
    await render();

    radio('local').click();
    await fixture.whenStable();
    await press('Continue');

    expect(server.serverUrl()).toBe(LOCAL_SERVER_URL);
    // Blank, so no X-API-Key header reaches a server started without keys.
    expect(server.apiKey()).toBe('');
    expect(heading()).toBe('Settings');
  });

  it('changes nothing when dismissed, even from a server already chosen', async () => {
    server.useLocalServer();
    await render();

    await press('Decide later');

    // The whole reason this may be asked on every load: Escape has to be free.
    expect(server.serverUrl()).toBe(LOCAL_SERVER_URL);
    expect(heading()).toBe('Overview');
  });

  it('stays on the public server when that is confirmed', async () => {
    await render();

    await press('Continue');

    expect(server.serverUrl()).toBe(DEFAULT_SERVER_URL);
    expect(heading()).toBe('Overview');
  });

  it('does not ask when no work is going to a server at all', async () => {
    compute.setExperimental(true);
    compute.setTarget('transcript', 'local');
    compute.setTarget('scene_stats', 'local');

    await render();

    expect(dialog()).toBeNull();
  });
});
