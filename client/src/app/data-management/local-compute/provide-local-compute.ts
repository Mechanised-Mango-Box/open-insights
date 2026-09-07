import { EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { provideAppInitializer } from '@angular/core';
import { ComputeQueueService } from './compute-queue.service';
import { sceneStatsComputer, supportsSceneStats } from './scene-stats/scene-stats.computer';

/**
 * Declares what this browser can compute for itself.
 *
 * Registration is conditional on the browser actually having the API, which is
 * what makes the Settings switch honest: a kind that cannot run here is never
 * offered, rather than offered and then failing on the first video.
 */
export function provideLocalCompute(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      const queue = inject(ComputeQueueService);
      if (supportsSceneStats()) queue.register('scene_stats', sceneStatsComputer);
    }),
  ]);
}
