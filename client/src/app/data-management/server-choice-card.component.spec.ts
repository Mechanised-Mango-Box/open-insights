import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HomeComponent } from '../views/home.component';
import { ViewId } from '../views/views';
import { DatasetProvider } from './providers/dataset-provider';
import { signal } from '@angular/core';
import { DEFAULT_SERVER_URL, LOCAL_SERVER_URL, ServerConfigService } from './server-config.service';

/**
 * Rendered through Home rather than on its own, so the navigate output is
 * carried by the same re-emit the app actually uses - a card that switched
 * servers but stopped reaching Settings would still pass in isolation.
 */
describe('the server-choice card', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HomeComponent>>;
  let server: ServerConfigService;
  let navigated: ViewId[];

  const panels = () => [...fixture.nativeElement.querySelectorAll('.option')] as HTMLElement[];
  const publicPanel = () => panels()[0];
  const localPanel = () => panels()[1];
  const switchIn = (panel: HTMLElement) =>
    [...panel.querySelectorAll('button')].find((b) =>
      b.textContent?.trim().startsWith('Use this server'),
    ) as HTMLButtonElement | undefined;

  beforeEach(async () => {
    globalThis.localStorage?.clear();

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [{ provide: DatasetProvider, useValue: { label: signal('somewhere') } }],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    server = TestBed.inject(ServerConfigService);

    navigated = [];
    fixture.componentInstance.navigate.subscribe((view: ViewId) => navigated.push(view));
    await fixture.whenStable();
  });

  it('marks the server in use, and follows a change without a reload', async () => {
    expect(publicPanel().textContent).toContain('In use now');
    expect(localPanel().textContent).not.toContain('In use now');

    server.useLocalServer();
    await fixture.whenStable();

    expect(publicPanel().textContent).not.toContain('In use now');
    expect(localPanel().textContent).toContain('In use now');
  });

  it('offers the switch only on the panel that is not in use', async () => {
    // One button, never two and never a disabled one: the panel you are already
    // on has nothing to offer, and its guard would no-op behind the press.
    expect(switchIn(publicPanel())).toBeUndefined();
    expect(switchIn(localPanel())).toBeDefined();

    server.useLocalServer();
    await fixture.whenStable();

    expect(switchIn(publicPanel())).toBeDefined();
    expect(switchIn(localPanel())).toBeUndefined();
  });

  it('switches to a local server and sends you where it can be checked', async () => {
    switchIn(localPanel())!.click();
    await fixture.whenStable();

    expect(server.serverUrl()).toBe(LOCAL_SERVER_URL);
    expect(server.apiKey()).toBe('');
    expect(navigated).toEqual(['settings']);
  });

  it('switches back to the public server', async () => {
    server.useLocalServer();
    await fixture.whenStable();

    switchIn(publicPanel())!.click();
    await fixture.whenStable();

    expect(server.serverUrl()).toBe(DEFAULT_SERVER_URL);
    // That this does not pin the browser to today's address is the setters'
    // job, and is asserted against them in server-config.service.spec.ts -
    // this runner has no localStorage to read back here.
    // Staying put, unlike the local switch: there is nothing to go and verify.
    expect(navigated).toEqual([]);
  });
});
