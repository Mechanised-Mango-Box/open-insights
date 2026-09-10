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
}
