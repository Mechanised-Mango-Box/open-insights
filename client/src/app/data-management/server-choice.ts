import { InjectionToken } from '@angular/core';

/**
 * The facts behind "which server should this browser use", in one place.
 *
 * The card on the Overview and the dialog that opens on load make the same
 * argument to different audiences, and both quote the public server's limits.
 * Kept here so the two cannot drift into quoting different numbers.
 */

/** Which of the two a person picked. */
export type ServerChoice = 'public' | 'local';

/** Where the portable server builds are published. */
export const RELEASES_URL = 'https://github.com/Mechanised-Mango-Box/open-insights/releases';

/**
 * What the public tier actually allows, mirroring the environment the public
 * box is brought up with in `docker-compose.yml` - PUBLIC_MAX_UPLOAD_BYTES,
 * PUBLIC_UPLOAD_RATE_LIMIT and PUBLIC_MAX_QUEUE_DEPTH, alongside the single
 * WHISPER_NUM_WORKERS / SCENE_STATS_WORKERS the compose file sets.
 *
 * These are the honest reason the shared server is slow: not weak hardware, but
 * one worker per task shared with everyone else, reached over the network.
 * Change them here whenever the compose file changes.
 */
export const PUBLIC_MAX_UPLOAD = '512MB';
export const PUBLIC_UPLOADS_PER_HOUR = 20;
export const PUBLIC_QUEUE_DEPTH = 8;

/**
 * Whether the shell asks where work should run when it starts.
 *
 * A seam for tests, not a setting: the prompt opens an overlay from
 * ViewManager's first render, and every spec that renders the shell would
 * otherwise get one - leaking overlays between tests and burying the markup
 * they are actually asserting on.
 */
export const SERVER_CHOICE_PROMPT = new InjectionToken<boolean>('server choice prompt', {
  factory: () => true,
});
