import { Injectable, computed, inject } from '@angular/core';
import { ComputeConfigService } from './compute-config.service';
import { DEFAULT_SERVER_URL, ServerConfigService } from './server-config.service';
import { DATASET_KINDS, DatasetProvider } from './providers/dataset-provider';

/**
 * The one-word summary of where this browser's work is going.
 *
 * Note the deliberate clash with `ComputeTarget`: there, `'local'` means *this
 * browser*; here it means *a dataset server you run yourself*, which is the
 * distinction a person actually cares about when glancing at a badge. Browser
 * compute is its own mode rather than a flavour of local, because what it
 * changes is the numbers, not just the machine.
 */
export type ProcessingMode = 'cloud' | 'local' | 'experimental';

@Injectable({ providedIn: 'root' })
export class ProcessingModeService {
  private computeConfig = inject(ComputeConfigService);
  private serverConfig = inject(ServerConfigService);
  private provider = inject(DatasetProvider);

  /**
   * Experimental wins over the server URL, because it is the state worth
   * warning about: a browser transcript comes from a much smaller model, so the
   * word counts shift. Which server the *other* kind still uses is a detail by
   * comparison, and the tooltip carries it.
   *
   * Asks `targetFor` rather than reading `targets()` directly - it already
   * returns 'server' while the experiment is switched off, so a per-kind
   * preference left in localStorage from an earlier session cannot make this
   * badge claim an experiment that is not running.
   */
  readonly mode = computed<ProcessingMode>(() => {
    if (DATASET_KINDS.some((kind) => this.computeConfig.targetFor(kind) === 'local')) {
      return 'experimental';
    }
    // Anything that is not the URL we ship is treated as a server the user
    // brought themselves, whether or not it is on this machine. A colleague's
    // box reads as "Local" on that basis; the tooltip names it either way.
    return this.serverConfig.serverUrl() === DEFAULT_SERVER_URL ? 'cloud' : 'local';
  });

  /** The long form, for the badge's tooltip. Reuses the routing provider's
   * existing label, which already names both places while the kinds are split. */
  readonly detail = computed(() => this.provider.label());
}
