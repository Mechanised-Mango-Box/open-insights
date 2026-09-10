import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProcessingModeService } from './processing-mode.service';
import { ComputeConfigService } from './compute-config.service';
import { DEFAULT_SERVER_URL, LOCAL_SERVER_URL, ServerConfigService } from './server-config.service';
import { DatasetProvider } from './providers/dataset-provider';

describe('ProcessingModeService', () => {
  let mode: ProcessingModeService;
  let compute: ComputeConfigService;
  let server: ServerConfigService;

  beforeEach(() => {
    // Both config services read localStorage on construction, so a mode left
    // behind by the previous test would carry into this one.
    globalThis.localStorage?.clear();

    TestBed.configureTestingModule({
      providers: [{ provide: DatasetProvider, useValue: { label: signal('somewhere') } }],
    });
    mode = TestBed.inject(ProcessingModeService);
    compute = TestBed.inject(ComputeConfigService);
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

  it('reads as experimental once any kind is routed to the browser', () => {
    compute.setExperimental(true);
    compute.setTarget('transcript', 'local');

    expect(mode.mode()).toBe('experimental');
  });

  it('lets experimental win over the server URL, even for one kind of two', () => {
    server.setServerUrl(LOCAL_SERVER_URL);
    compute.setExperimental(true);
    compute.setTarget('scene_stats', 'local');

    // Transcript is still on the local server, but the browser-computed half is
    // the part worth warning about.
    expect(compute.targetFor('transcript')).toBe('server');
    expect(mode.mode()).toBe('experimental');
  });

  it('does not claim an experiment that is switched off', () => {
    // The per-kind preference survives being switched off, so a setting left
    // over from an earlier session must not light up the badge on the next load.
    compute.setExperimental(true);
    compute.setTarget('transcript', 'local');
    compute.setExperimental(false);

    expect(mode.mode()).toBe('cloud');

    server.setServerUrl(LOCAL_SERVER_URL);
    expect(mode.mode()).toBe('local');
  });

  it('carries the routing provider label for the tooltip', () => {
    expect(mode.detail()).toBe('somewhere');
  });
});
