import { Injectable, signal } from '@angular/core';
import { DatasetKind } from './providers/dataset-provider';

export type ComputeTarget = 'local' | 'server';

const STORAGE_KEY = 'openInsights.computeTargets';

/**
 * Where each kind of work runs by default.
 *
 * Per kind rather than one global switch, because the two move to the browser
 * at different times: scene stats only need a decoder, transcription needs a
 * model download and a GPU. A kind flips here once its local path is proven
 * against the golden results, and until then it stays on the server.
 */
const DEFAULT_TARGETS: Record<DatasetKind, ComputeTarget> = {
  transcript: 'server',
  scene_stats: 'server',
};

@Injectable({ providedIn: 'root' })
export class ComputeConfigService {
  readonly targets = signal<Record<DatasetKind, ComputeTarget>>(this.readStored());

  targetFor(kind: DatasetKind): ComputeTarget {
    return this.targets()[kind];
  }

  setTarget(kind: DatasetKind, target: ComputeTarget): void {
    const next = { ...this.targets(), [kind]: target };
    this.targets.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (private mode etc.) - value still applies for this session
    }
  }

  /**
   * Merged onto the defaults rather than trusted wholesale: a kind added after a
   * setting was stored is missing from it, and anything at all could be sitting
   * under this key. An unreadable setting is not worth failing over - it just
   * means the defaults apply.
   */
  private readStored(): Record<DatasetKind, ComputeTarget> {
    const merged = { ...DEFAULT_TARGETS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return merged;
      const parsed = JSON.parse(raw) as Partial<Record<DatasetKind, ComputeTarget>>;
      for (const kind of Object.keys(DEFAULT_TARGETS) as DatasetKind[]) {
        const value = parsed[kind];
        if (value === 'local' || value === 'server') merged[kind] = value;
      }
    } catch {
      // Unreadable or malformed - the defaults above already stand.
    }
    return merged;
  }
}
