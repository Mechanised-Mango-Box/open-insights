import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../app.config';
import { ViewManager } from '../views/view-manager.component';
import { LOCAL_SERVER_URL, ServerConfigService } from './server-config.service';
import { SERVER_CHOICE_PROMPT } from './server-choice';

/**
 * Rendered through the real sidebar rather than the badge on its own: half of
 * what this change is worth is *where* it sits, and a badge tested in isolation
 * would still pass after being dropped from the nav.
 */
describe('the processing-mode badge in the sidebar', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<ViewManager>>;
  let server: ServerConfigService;

  const badge = () => fixture.nativeElement.querySelector('.mode-badge') as HTMLElement | null;

  beforeEach(async () => {
    globalThis.localStorage?.clear();

    await TestBed.configureTestingModule({
      imports: [ViewManager],
      // Without this the shell opens the server-choice dialog on first render,
      // leaking an overlay into every later spec.
      providers: [...appConfig.providers, { provide: SERVER_CHOICE_PROMPT, useValue: false }],
    }).compileComponents();

    fixture = TestBed.createComponent(ViewManager);
    await fixture.whenStable();
    server = TestBed.inject(ServerConfigService);
  });

  it('renders above the Settings nav item, inside the sidebar footer', () => {
    const footer = fixture.nativeElement.querySelector('.sidebar-footer') as HTMLElement;
    const children = [...footer.children];

    expect(children[0].tagName.toLowerCase()).toBe('processing-mode-badge');
    expect(children[1].classList).toContain('settings');
    expect(footer.querySelector('.settings')?.textContent).toContain('Settings');
  });

  it('names the mode, and follows a settings change without a reload', async () => {
    expect(badge()?.textContent?.trim()).toBe('Cloud');

    server.setServerUrl(LOCAL_SERVER_URL);
    await fixture.whenStable();
    expect(badge()?.textContent?.trim()).toBe('Local');
    expect(badge()?.classList).toContain('mode-local');
  });

  it("names the actual place in its tooltip, so 'Local' is never ambiguous", async () => {
    server.setServerUrl(LOCAL_SERVER_URL);
    await fixture.whenStable();

    expect(badge()?.getAttribute('title')).toBe(`Work runs on: ${LOCAL_SERVER_URL}`);
  });
});
