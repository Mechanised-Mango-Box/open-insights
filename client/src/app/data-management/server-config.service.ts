import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'openInsights.serverUrl';
const API_KEY_STORAGE_KEY = 'openInsights.serverApiKey';

/** The shared public server. Change "Use local" in Settings to point at one you
 * run yourself. */
export const DEFAULT_SERVER_URL = 'https://open-insights.duckdns.org';

/** Where "Use local" goes back to, and what a self-hosted server listens on. */
export const LOCAL_SERVER_URL = 'http://localhost:5000';

/**
 * The key sent with every request to the public server.
 *
 * This is not a secret and is not treated as one. It ships inside a bundle
 * served from a public static site, so anybody who opens devtools has it. What
 * it buys is friction against drive-by scripted abuse, and something the
 * operator can rotate when someone leans on it - the public tier it unlocks is
 * rate limited and capped on the server regardless of who is holding it.
 *
 * A private key, which is exempt from those limits, is pasted into Settings by
 * whoever runs the server and never appears here.
 */
export const DEFAULT_API_KEY = 'uhGlfDyQ6V1CCUwIo90j722MQfzg3N3O';

@Injectable({ providedIn: 'root' })
export class ServerConfigService {
  serverUrl = signal<string>(this.read(STORAGE_KEY) ?? DEFAULT_SERVER_URL);

  /** Sent as X-API-Key. Empty is meaningful: a server with no keys configured -
   * which is what `py main.py` gives you - rejects nothing and wants no header. */
  apiKey = signal<string>(this.read(API_KEY_STORAGE_KEY) ?? DEFAULT_API_KEY);

  setServerUrl(url: string): void {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed) return;
    this.serverUrl.set(trimmed);
    this.write(STORAGE_KEY, trimmed);
  }

  /** Unlike the URL, an empty key is a legitimate value - it is what you want
   * against a server that has no keys configured - so this does not reject one. */
  setApiKey(key: string): void {
    const trimmed = key.trim();
    this.apiKey.set(trimmed);
    this.write(API_KEY_STORAGE_KEY, trimmed);
  }

  /**
   * Back to the server this build ships with.
   *
   * Clears the stored values rather than writing the current constants into
   * them: an absent setting means "follow whatever the bundle points at", which
   * is how a change of host reaches everyone who never chose anything. Writing
   * DEFAULT_SERVER_URL in would pin this browser to today's address forever.
   *
   * Guarded, because this runs from a dialog that opens on every load: someone
   * who pasted a private key - the rate-limit-exempt one - against the shared
   * server would otherwise lose it to a stray Continue.
   */
  usePublicServer(): void {
    if (this.serverUrl() === DEFAULT_SERVER_URL) return;
    this.serverUrl.set(DEFAULT_SERVER_URL);
    this.apiKey.set(DEFAULT_API_KEY);
    this.clear(STORAGE_KEY);
    this.clear(API_KEY_STORAGE_KEY);
  }

  /**
   * Point at a server the user runs, and drop the shared key on the way - a
   * server started with no keys configured wants no X-API-Key header at all.
   *
   * Only moves a browser that is still on the shipped default. Anything else is
   * already a server somebody chose - a box on the LAN, a colleague's machine -
   * and localhost is not a safe guess at what they meant.
   */
  useLocalServer(): void {
    if (this.serverUrl() !== DEFAULT_SERVER_URL) return;
    this.setServerUrl(LOCAL_SERVER_URL);
    this.setApiKey('');
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // localStorage unavailable (private mode etc.) — value still applies for this session
    }
  }

  private clear(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // As above - nothing stored means the shipped default applies next load.
    }
  }
}
