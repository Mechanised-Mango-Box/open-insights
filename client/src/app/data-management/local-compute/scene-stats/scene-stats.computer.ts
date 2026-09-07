import { Computer } from '../compute-queue.service';
import { SceneStats } from '../../video-records/Dataset';
import type {
  SceneStatsRequest,
  SceneStatsResponse,
  SceneStatsResult,
  SceneStatsTimings,
} from './scene-stats.worker';

/**
 * The threshold a frame's mean absolute difference has to clear to count as a
 * cut. Matches SCENE_THRESHOLD in server/config.py, and is in the producer
 * string below - changing it here without changing that would leave results
 * made under the old value looking current.
 */
export const SCENE_THRESHOLD = 30;

/**
 * Everything about this implementation that could move the numbers.
 *
 * `webcodecs` rather than `opencv` because the decode path is genuinely a
 * different one: same definition, same threshold, but frames that have been
 * through the browser's YUV-to-RGB rather than FFmpeg's. `full-res` records
 * that nothing is downscaled, which would low-pass exactly the detail a cut
 * shows up in.
 */
export const SCENE_STATS_PRODUCER_LOCAL = `webcodecs/threshold=${SCENE_THRESHOLD}/full-res`;

/** Whether this browser can decode video frame by frame at all. */
export function supportsSceneStats(): boolean {
  return typeof VideoDecoder !== 'undefined';
}

/**
 * Runs one video through a worker per call.
 *
 * A worker per video rather than a long-lived pool: the queue already bounds
 * how many run at once, and a fresh worker per file means a decoder left in a
 * bad state by a malformed video cannot affect the next one.
 */
export function measureSceneStats(
  file: File,
): Promise<{ result: SceneStatsResult; timings: SceneStatsTimings }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./scene-stats.worker', import.meta.url), {
      type: 'module',
    });

    const finish = (settle: () => void) => {
      worker.terminate();
      settle();
    };

    worker.onmessage = ({ data }: MessageEvent<SceneStatsResponse>) => {
      if (data.ok) finish(() => resolve({ result: data.result, timings: data.timings }));
      else finish(() => reject(new Error(data.error)));
    };

    // Fires for a worker that failed to start or threw outside the handler -
    // without this the promise would never settle and the queue slot would
    // never come back.
    worker.onerror = (event) =>
      finish(() => reject(new Error(event.message || 'Scene stats worker failed.')));

    worker.postMessage({ file, threshold: SCENE_THRESHOLD } satisfies SceneStatsRequest);
  });
}

export const sceneStatsComputer: Computer<'scene_stats'> = {
  producer: SCENE_STATS_PRODUCER_LOCAL,

  async compute(file: File): Promise<SceneStats> {
    const { result, timings } = await measureSceneStats(file);
    // Logged rather than shown: which of these three dominates is what decides
    // whether this stage is worth optimising and where, and it is not something
    // to have to re-instrument to find out.
    console.log(
      `Scene stats: ${timings.frames} frames in ${timings.total_secs.toFixed(1)}s ` +
        `(readback ${timings.copy_secs.toFixed(1)}s, ` +
        `greyscale+diff ${timings.pixels_secs.toFixed(1)}s, ` +
        `demux+decode ${timings.other_secs.toFixed(1)}s)`,
    );
    return result;
  },
};
