import { Injectable, computed, inject } from '@angular/core';
import { DEFAULT_SERVER_URL, ServerConfigService } from './server-config.service';
import { DatasetProvider } from './providers/dataset-provider';

/**
 * The one-word summary of where this browser's work is going.
 *
 * 'local' means *a dataset server you run yourself*, which is the distinction a
 * person actually cares about when glancing at a badge - not that the work
 * happens on this machine.
 */
export type ProcessingMode = 'cloud' | 'local';

@Injectable({ providedIn: 'root' })
export class ProcessingModeService {
  private serverConfig = inject(ServerConfigService);
  private provider = inject(DatasetProvider);

  readonly mode = computed<ProcessingMode>(() =>
    // Anything that is not the URL we ship is treated as a server the user
    // brought themselves, whether or not it is on this machine. A colleague's
    // box reads as "Local" on that basis; the tooltip names it either way.
    this.serverConfig.serverUrl() === DEFAULT_SERVER_URL ? 'cloud' : 'local',
  );

  /** The long form, for the badge's tooltip. Reuses the provider's existing
   * label, which already names the place the work goes to. */
  readonly detail = computed(() => this.provider.label());
}
