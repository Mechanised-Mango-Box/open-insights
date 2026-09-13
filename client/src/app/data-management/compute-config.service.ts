import { Injectable, signal } from '@angular/core';
import { DatasetKind } from './providers/dataset-provider';

export type ComputeTarget = 'local' | 'server';

const STORAGE_KEY = 'openInsights.computeTargets';
const EXPERIMENTAL_KEY = 'openInsights.computeExperimental';

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

  /**
   * Whether browser compute may be used at all.
   *
   * The server is the supported path; running the work in the browser is an
   * experiment - slower, narrower in what it accepts, and not yet checked
   * against the known-good results. Off unless deliberately turned on.
   */
  readonly experimental = signal<boolean>(this.readExperimental());

  /**
   * Gated here rather than at each call site, so a per-kind preference left in
   * localStorage from an earlier session cannot quietly route work to the
   * browser once the experiment is switched back off. The preference is kept,
   * not cleared - turning it on again restores what was chosen before.
   */
  targetFor(kind: DatasetKind): ComputeTarget {
    return this.experimental() ? this.targets()[kind] : 'server';
  }

  setExperimental(enabled: boolean): void {
    this.experimental.set(enabled);
    try {
      localStorage.setItem(EXPERIMENTAL_KEY, String(enabled));
    } catch {
      // localStorage unavailable (private mode etc.) - value still applies for this session
    }
  }

  private readExperimental(): boolean {
    try {
      return localStorage.getItem(EXPERIMENTAL_KEY) === 'true';
    } catch {
      return false;
    }
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
