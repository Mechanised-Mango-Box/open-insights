/**
 * The arithmetic behind scene stats, kept apart from the decoding so it can be
 * tested without a video.
 *
 * Ported from count_scene_transitions() in server/processing.py. The definition
 * being reproduced is: convert each frame to greyscale, take the mean absolute
 * difference against the frame before it, and count the frames where that mean
 * is strictly greater than the threshold.
 */

/**
 * Greyscale, using the BT.601 weights and rounding that cv2.COLOR_BGR2GRAY uses.
 *
 * The server's frames reached OpenCV as RGB, because FFmpeg had already
 * converted them out of the file's YUV using the track's matrix and range. A
 * VideoFrame copied out as RGBA has been through that same conversion, so
 * applying the same weights here lands on the same numbers - to within
 * rounding, not bit-exactly, since the RGB round-trip is lossy.
 *
 * Reading the decoder's native I420 Y plane instead would be faster and would
 * be wrong: that Y is video-range (16-235) luma of the *source*, so its
 * differences run about 219/255 of these, and every threshold comparison would
 * quietly shift.
 *
 * Integer arithmetic, not float: these are OpenCV's own 14-bit fixed-point
 * coefficients, so this is what cv2 computes rather than an approximation of
 * it - and integer multiply-shift is markedly faster than float in a loop that
 * runs two million times per frame. The +(1<<13) is the half-bit that makes the
 * shift round rather than truncate.
 */
const LUMA_R = 4899;
const LUMA_G = 9617;
const LUMA_B = 1868;
const LUMA_HALF = 1 << 13;
const LUMA_SHIFT = 14;

export function toLuma(rgba: Uint8ClampedArray | Uint8Array, out: Uint8Array): void {
  for (let pixel = 0, i = 0; pixel < out.length; pixel++, i += 4) {
    out[pixel] =
      (rgba[i] * LUMA_R + rgba[i + 1] * LUMA_G + rgba[i + 2] * LUMA_B + LUMA_HALF) >> LUMA_SHIFT;
  }
}

/**
 * Counts scene transitions over a stream of greyscale frames.
 *
 * Streaming rather than taking an array: a 14-minute video is ~25,000 frames of
 * ~2MB each, which is not something to hold in memory to average pairs of.
 *
 * The first frame can never be a transition - it has nothing to differ from -
 * which is what makes a still video report 0 rather than 1.
 */
export class SceneCounter {
  private previous: Uint8Array | null = null;
  /** The frame being written now. Swapped with `previous` rather than copied
   * over it - at 2MB a frame, copying is 37GB across a 14-minute video. */
  private scratch: Uint8Array | null = null;
  private transitions = 0;
  private seen = 0;

  constructor(private readonly threshold: number) {}

  /**
   * Feeds one greyscale frame. The reference implementation of the definition:
   * simple enough to check by eye, and what pushRgba() is tested against.
   *
   * The buffer is copied, so callers are free to reuse theirs.
   */
  push(gray: Uint8Array): void {
    const target = this.take(gray.length);
    target.set(gray);
    this.commit(this.difference(target, gray.length), gray.length);
  }

  /**
   * Feeds one RGBA frame, converting and differencing in a single pass.
   *
   * The two-step form reads the frame twice - once to make greyscale, once to
   * difference it - and writes a whole frame in between. Fusing them halves the
   * per-pixel work, which on 1080p is two million iterations a frame either way.
   *
   * `stride` is the row pitch of the source, which a decoder is free to pad
   * beyond width * 4.
   */
  pushRgba(rgba: Uint8Array, width: number, height: number, stride: number): void {
    const pixels = width * height;
    const target = this.take(pixels);
    const previous = this.previous?.length === pixels ? this.previous : null;

    let total = 0;
    let pixel = 0;
    for (let y = 0; y < height; y++) {
      let i = y * stride;
      for (let x = 0; x < width; x++, i += 4, pixel++) {
        const luma =
          (rgba[i] * LUMA_R + rgba[i + 1] * LUMA_G + rgba[i + 2] * LUMA_B + LUMA_HALF) >>
          LUMA_SHIFT;
        target[pixel] = luma;
        if (previous) {
          const difference = luma - previous[pixel];
          total += difference < 0 ? -difference : difference;
        }
      }
    }

    this.commit(previous ? total : null, pixels);
  }

  /** The buffer to write this frame into, sized for it. */
  private take(pixels: number): Uint8Array {
    if (this.scratch?.length !== pixels) this.scratch = new Uint8Array(pixels);
    return this.scratch;
  }

  /** Sum of absolute differences against the previous frame, or null when there
   * is nothing comparable to difference against. */
  private difference(current: Uint8Array, pixels: number): number | null {
    const previous = this.previous;
    if (previous?.length !== pixels) return null;
    // Integer accumulation, exact until 2^53 - a 4K frame maxes out around
    // 2e9, so this is the same number numpy's float64 mean() arrives at.
    let total = 0;
    for (let i = 0; i < pixels; i++) {
      const difference = current[i] - previous[i];
      total += difference < 0 ? -difference : difference;
    }
    return total;
  }

  /**
   * Records the frame. A null total means there was no comparable predecessor -
   * the first frame, or the one after a resolution change - which scores no
   * transition and becomes the new baseline.
   */
  private commit(total: number | null, pixels: number): void {
    this.seen += 1;
    if (total !== null && total / pixels > this.threshold) this.transitions += 1;
    const written = this.scratch;
    this.scratch = this.previous;
    this.previous = written;
  }

  get scenes(): number {
    return this.transitions;
  }

  /** Frames actually decoded - the numerator of the duration, since the server
   * derives its own from the container's frame count over its fps. */
  get frames(): number {
    return this.seen;
  }
}
