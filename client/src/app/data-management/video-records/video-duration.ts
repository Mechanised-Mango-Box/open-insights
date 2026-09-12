import { readyData } from './Dataset';
import { VideoRecord } from './VideoRecord';

/**
 * How long a video is, from whichever source has an answer: the YouTube export
 * first, then scene stats (OpenCV over the file), then the file in the browser.
 *
 * Each tier is gated on > 0, not merely on being present, so a zero from a probe
 * that opened a file but got nothing useful out of it falls through to the next
 * source instead of winning and rendering as "0:00". This mirrors the
 * `duration_secs <= 0` guard the analysis pipeline already applies.
 *
 * Shared rather than private to the table because Scan needs the same answer:
 * the speech features stored on TranscriptStats are computed against this, and a
 * second definition that disagreed would make a stored stat disagree with the
 * duration shown beside it.
 */
export const recordDurationTiers = (record: VideoRecord): { secs: number; source: string }[] => {
  const candidates = [
    { secs: record.ds_youtubeContent?.duration_secs, source: 'From YouTube content report' },
    {
      secs: readyData(record.ds_sceneStats)?.duration_secs,
      source: 'From video file (scene stats)',
    },
    { secs: record.video_file.duration_secs, source: 'From local video file' },
  ];
  return candidates.filter(
    (tier): tier is { secs: number; source: string } => (tier.secs ?? 0) > 0,
  );
};

export const recordDurationSecs = (record: VideoRecord): number | null =>
  recordDurationTiers(record)[0]?.secs ?? null;

/** Provenance of the value above, shown as the duration cell's tooltip. */
export const recordDurationSource = (record: VideoRecord): string | null =>
  recordDurationTiers(record)[0]?.source ?? null;

/**
 * Reads a video file's duration in the browser, without decoding the whole
 * thing: `preload = 'metadata'` stops once the container header is in, which is
 * what carries the duration.
 *
 * This is the last of the three duration sources the table falls back through,
 * and the only one that needs no server - so it is what a freshly attached file
 * shows before scene stats have ever been computed for it.
 *
 * Resolves null rather than rejecting for anything unusable: a container the
 * browser cannot demux, and the Infinity that some streamed/fragmented MP4s
 * report in place of a length. Callers store the result, so a null has to mean
 * "no answer" rather than becoming a 0 that would out-rank a real duration.
 */
export const readFileDurationSecs = (file: File): Promise<number | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');

    // Revoking has to happen on both paths or every scan leaks its blob for the
    // lifetime of the document.
    const finish = (duration: number | null) => {
      URL.revokeObjectURL(url);
      resolve(duration);
    };

    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
