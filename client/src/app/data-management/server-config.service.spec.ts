import { TestBed } from '@angular/core/testing';
import { effect } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_API_KEY,
  DEFAULT_SERVER_URL,
  LOCAL_SERVER_URL,
  ServerConfigService,
} from './server-config.service';

/**
 * The two choice methods are almost all guard, and the guards are what stop a
 * dialog that opens on every load from quietly undoing somebody's setup.
 */
describe('ServerConfigService', () => {
  let server: ServerConfigService;
  let stored: Map<string, string>;
  const noStorage = Symbol('absent');
  let original: unknown;

  beforeEach(() => {
    // This runner has no localStorage at all, and the service degrades to
    // signals-only without one - which would quietly make the assertions below
    // about *what is stored* pass for the wrong reason. A stub keeps them real.
    stored = new Map();
    original = 'localStorage' in globalThis ? globalThis.localStorage : noStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => void stored.set(key, value),
        removeItem: (key: string) => void stored.delete(key),
        clear: () => stored.clear(),
      },
    });

    TestBed.configureTestingModule({});
    server = TestBed.inject(ServerConfigService);
  });

  afterEach(() => {
    if (original === noStorage) {
      delete (globalThis as Record<string, unknown>)['localStorage'];
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it('sends local work to localhost with no key at all', () => {
    server.useLocalServer();

    expect(server.serverUrl()).toBe(LOCAL_SERVER_URL);
    // Empty, not the shared key: a server started with no keys configured wants
    // no X-API-Key header, which is what an empty string produces.
    expect(server.apiKey()).toBe('');
  });

  it('clears the stored URL rather than writing the current default into it', () => {
    server.useLocalServer();
    server.usePublicServer();

    expect(server.serverUrl()).toBe(DEFAULT_SERVER_URL);
    expect(server.apiKey()).toBe(DEFAULT_API_KEY);
    // The point of the whole method: nothing stored means "follow whatever this
    // build ships", so a change of host still reaches this browser. Storing the
    // URL would pin it to today's address.
    expect(localStorage.getItem('openInsights.serverUrl')).toBeNull();
    expect(localStorage.getItem('openInsights.serverApiKey')).toBeNull();
  });

  it('never stores a value the build already ships, whichever setter wrote it', () => {
    // Settings commits through the plain setters, so the property has to hold
    // there too - otherwise pressing "Use public" and Save pins this browser to
    // today's address, which is exactly what usePublicServer avoids.
    server.setServerUrl(DEFAULT_SERVER_URL);
    server.setApiKey(DEFAULT_API_KEY);

    expect(server.serverUrl()).toBe(DEFAULT_SERVER_URL);
    expect(server.apiKey()).toBe(DEFAULT_API_KEY);
    expect(localStorage.getItem('openInsights.serverUrl')).toBeNull();
    expect(localStorage.getItem('openInsights.serverApiKey')).toBeNull();
  });

  it('still stores anything that is not the default', () => {
    server.setServerUrl('http://box.lan:5000');
    server.setApiKey('a-private-key');

    expect(localStorage.getItem('openInsights.serverUrl')).toBe('http://box.lan:5000');
    expect(localStorage.getItem('openInsights.serverApiKey')).toBe('a-private-key');
  });

  it('stores an emptied key, which is not the same as never having set one', () => {
    // '' is a real choice - no X-API-Key header - and has to survive a reload,
    // so it must be written rather than treated as "nothing stored".
    server.setApiKey('');

    expect(localStorage.getItem('openInsights.serverApiKey')).toBe('');
  });

  it('leaves a server the user brought themselves alone', () => {
    const theirs = 'http://box.lan:5000';
    server.setServerUrl(theirs);

    // The dialog preselects "local" for this URL, so Continue reaches here -
    // and localhost is not a safe guess at what they meant.
    server.useLocalServer();

    expect(server.serverUrl()).toBe(theirs);
  });

  it('does not wipe a private key held against the public server', () => {
    const privateKey = 'a-rate-limit-exempt-key';
    server.setApiKey(privateKey);

    server.usePublicServer();

    expect(server.apiKey()).toBe(privateKey);
  });

  it('does not notify on a choice that changes nothing', () => {
    let runs = 0;
    TestBed.runInInjectionContext(() => {
      effect(() => {
        server.serverUrl();
        runs++;
      });
    });
    TestBed.tick();
    expect(runs).toBe(1);

    server.usePublicServer();
    server.usePublicServer();
    TestBed.tick();

    // dataset-actions invalidates every cached per-record status when this
    // signal changes. A prompt shown on every load must not keep triggering it.
    expect(runs).toBe(1);
  });
});
