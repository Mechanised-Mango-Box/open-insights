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
