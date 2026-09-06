import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'openInsights.serverUrl';
export const DEFAULT_SERVER_URL = 'http://localhost:5000';

@Injectable({ providedIn: 'root' })
export class ServerConfigService {
  serverUrl = signal<string>(this.readStored() ?? DEFAULT_SERVER_URL);

  setServerUrl(url: string): void {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed) return;
    this.serverUrl.set(trimmed);
    try {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      // localStorage unavailable (private mode etc.) — value still applies for this session
    }
  }

  private readStored(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
