import { describe, expect, it } from 'vitest';
import { SceneCounter, toLuma } from './scene-metrics';

/** One RGBA pixel repeated, as a decoder would hand it over. */
const solid = (r: number, g: number, b: number, pixels = 4): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) out.set([r, g, b, 255], i * 4);
  return out;
};

const luma = (rgba: Uint8ClampedArray): Uint8Array => {
  const out = new Uint8Array(rgba.length / 4);
  toLuma(rgba, out);
  return out;
};

const flat = (value: number, pixels = 4): Uint8Array => new Uint8Array(pixels).fill(value);

describe('toLuma', () => {
  // The reference values OpenCV's BGR2GRAY produces for the primaries. Chosen
  // because they are independently known, rather than whatever this code does.
  it('matches OpenCV on the primaries', () => {
    expect(luma(solid(255, 0, 0, 1))[0]).toBe(76); // 0.299 * 255 = 76.245
    expect(luma(solid(0, 255, 0, 1))[0]).toBe(150); // 0.587 * 255 = 149.685
    expect(luma(solid(0, 0, 255, 1))[0]).toBe(29); // 0.114 * 255 = 29.07
  });

  it('keeps black and white exact', () => {
    expect(luma(solid(0, 0, 0, 1))[0]).toBe(0);
    expect(luma(solid(255, 255, 255, 1))[0]).toBe(255);
  });

  it('rounds half up rather than truncating', () => {
    // 0.299*2 + 0.587*1 + 0.114*1 = 1.299 -> 1 ; truncation would agree here,
    // so use a value that lands just over a boundary: 0.587*3 = 1.761 -> 2.
    expect(luma(solid(0, 3, 0, 1))[0]).toBe(2);
  });

  it('ignores alpha', () => {
    const opaque = solid(10, 20, 30, 1);
    const transparent = solid(10, 20, 30, 1);
    transparent[3] = 0;
    expect(luma(opaque)).toEqual(luma(transparent));
  });
});

describe('SceneCounter', () => {
  it('never counts the first frame - a still video reports zero', () => {
    const counter = new SceneCounter(30);
    counter.push(flat(0));
    expect(counter.scenes).toBe(0);

    counter.push(flat(0));
    counter.push(flat(0));
    expect(counter.scenes).toBe(0);
    expect(counter.frames).toBe(3);
  });

  it('counts a difference strictly greater than the threshold', () => {
    const counter = new SceneCounter(30);
    counter.push(flat(0));
    counter.push(flat(31));
    expect(counter.scenes).toBe(1);
  });

  it('does not count a difference exactly at the threshold', () => {
    const counter = new SceneCounter(30);
    counter.push(flat(0));
    counter.push(flat(30));
    expect(counter.scenes).toBe(0);
  });

  it('averages over every pixel, not just the changed ones', () => {
    // One pixel in four jumps the whole range: mean is 255/4 = 63.75.
    const counter = new SceneCounter(63);
    counter.push(flat(0));
    counter.push(new Uint8Array([255, 0, 0, 0]));
    expect(counter.scenes).toBe(1);

    const stricter = new SceneCounter(64);
    stricter.push(flat(0));
    stricter.push(new Uint8Array([255, 0, 0, 0]));
    expect(stricter.scenes).toBe(0);
  });

  it('is symmetric - a cut to black counts like a cut from it', () => {
    const down = new SceneCounter(30);
    down.push(flat(200));
    down.push(flat(0));

    const up = new SceneCounter(30);
    up.push(flat(0));
    up.push(flat(200));

    expect(down.scenes).toBe(up.scenes);
    expect(down.scenes).toBe(1);
  });

  it('compares against the previous frame, not the first', () => {
    const counter = new SceneCounter(30);
    // A slow ramp: each step is 20, under the threshold, though the total is not.
    for (const value of [0, 20, 40, 60, 80]) counter.push(flat(value));
    expect(counter.scenes).toBe(0);
  });

  it('copies the frame it is given, so callers can reuse the buffer', () => {
    const counter = new SceneCounter(30);
    const scratch = flat(0);

    counter.push(scratch);
    scratch.fill(200); // the decoder writes the next frame into the same buffer
    counter.push(scratch);

    expect(counter.scenes).toBe(1);
  });

  it('fuses conversion and differencing without changing the answer', () => {
    // pushRgba is an optimisation of "toLuma then push". The two must agree, or
    // the fast path is quietly measuring something else.
    const frames: Uint8ClampedArray[] = [];
    let seed = 7;
    for (let f = 0; f < 6; f++) {
      const frame = new Uint8ClampedArray(4 * 3 * 4); // 4x3 pixels
      for (let i = 0; i < frame.length; i += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        frame.set([seed % 256, (seed >> 8) % 256, (seed >> 16) % 256, 255], i);
      }
      frames.push(frame);
    }

    const reference = new SceneCounter(20);
    const fused = new SceneCounter(20);
    for (const frame of frames) {
      const gray = new Uint8Array(12);
      toLuma(frame, gray);
      reference.push(gray);
      fused.pushRgba(new Uint8Array(frame.buffer.slice(0)), 4, 3, 16);
    }

    expect(fused.scenes).toBe(reference.scenes);
    expect(fused.frames).toBe(reference.frames);
  });

  it('skips row padding when the decoder pads its stride', () => {
    // 2x2 pixels in a buffer whose rows are padded to 3 pixels' worth.
    const width = 2;
    const height = 2;
    const stride = 3 * 4;
    const padded = new Uint8Array(stride * height);
    const white = [255, 255, 255, 255];
    const black = [0, 0, 0, 255];
    for (let y = 0; y < height; y++) {
      padded.set(white, y * stride);
      padded.set(white, y * stride + 4);
      padded.set(black, y * stride + 8); // padding - must not be read
    }

    const counter = new SceneCounter(30);
    counter.pushRgba(padded, width, height, stride);
    counter.pushRgba(new Uint8Array(stride * height), width, height, stride);

    // All four real pixels went 255 -> 0, a mean difference of 255. Had the
    // padding been counted the mean would be lower.
    expect(counter.scenes).toBe(1);
  });

  it('treats a resolution change as a new baseline rather than a transition', () => {
    const counter = new SceneCounter(30);
    counter.push(flat(0, 4));
    counter.push(flat(255, 9));
    expect(counter.scenes).toBe(0);
    expect(counter.frames).toBe(2);

    counter.push(flat(0, 9));
    expect(counter.scenes).toBe(1);
  });
});
