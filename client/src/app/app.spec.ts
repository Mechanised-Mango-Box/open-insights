import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { appConfig } from './app.config';
import { SERVER_CHOICE_PROMPT } from './data-management/server-choice';

describe('App', () => {
  beforeEach(async () => {
    // The app's own providers rather than a hand-written subset: this is the
    // only test that renders the whole shell, so the thing worth checking is
    // that the real wiring stands up - DatasetProvider in particular, which the
    // sidebar's processing-mode badge reaches through.
    await TestBed.configureTestingModule({
      imports: [App],
      // The where-does-work-run prompt is switched off: it opens an overlay from
      // the shell's first render, which would outlive this fixture and bury the
      // markup below it.
      providers: [...appConfig.providers, { provide: SERVER_CHOICE_PROMPT, useValue: false }],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Overview');
  });
});
