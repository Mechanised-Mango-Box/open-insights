import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProcessingModeService } from './processing-mode.service';
import { DEFAULT_SERVER_URL, LOCAL_SERVER_URL, ServerConfigService } from './server-config.service';
import { DatasetProvider } from './providers/dataset-provider';

describe('ProcessingModeService', () => {
  let mode: ProcessingModeService;
  let server: ServerConfigService;

  beforeEach(() => {
    // ServerConfigService reads localStorage on construction, so a URL left
    // behind by the previous test would carry into this one.
    globalThis.localStorage?.clear();

    TestBed.configureTestingModule({
      providers: [{ provide: DatasetProvider, useValue: { label: signal('somewhere') } }],
    });
    mode = TestBed.inject(ProcessingModeService);
    server = TestBed.inject(ServerConfigService);
  });

  it('reads as cloud out of the box', () => {
    expect(server.serverUrl()).toBe(DEFAULT_SERVER_URL);
    expect(mode.mode()).toBe('cloud');
  });

  it('reads as local against a server the user brought themselves', () => {
    server.setServerUrl(LOCAL_SERVER_URL);
    expect(mode.mode()).toBe('local');
  });

  it('carries the provider label for the tooltip', () => {
    expect(mode.detail()).toBe('somewhere');
  });
});
