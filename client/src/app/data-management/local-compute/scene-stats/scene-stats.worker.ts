/// <reference lib="webworker" />
import { DataStream, MP4BoxBuffer, createFile, type Sample, type Track } from 'mp4box';
import { SceneCounter } from './scene-metrics';

export type SceneStatsRequest = { file: File; threshold: number };
export type SceneStatsResult = { duration_secs: number; scenes: number };

/** Where the time actually went, so "this is slow" can be answered with a
 * measurement rather than a guess about which stage dominates. */
export type SceneStatsTimings = {
  frames: number;
  /** Reading decoded frames back as RGBA - a GPU-to-CPU transfer per frame. */
  copy_secs: number;
  /** Greyscale conversion and differencing, in JS, over every pixel. */
  pixels_secs: number;
  /** Everything else: reading the file, demuxing, decoding. */
  other_secs: number;
  total_secs: number;
};

export type SceneStatsResponse =
  { ok: true; result: SceneStatsResult; timings: SceneStatsTimings } | { ok: false; error: string };

/**
 * How many decode requests may be outstanding before we stop feeding the
 * decoder. Every queued chunk becomes a full-resolution frame in GPU or system
 * memory, so an unbounded queue on a 25,000-frame video exhausts memory long
 * before it finishes.
 */
const MAX_DECODE_QUEUE = 24;
const RESUME_DECODE_QUEUE = 8;

/**
 * How many frame readbacks may be in flight at once.
 *
 * Each costs a buffer (8MB at 1080p) but hides the GPU-to-CPU round trip behind
 * the next one, which is otherwise paid in full per frame. Four is enough to
 * keep the transfer busy without holding an unreasonable amount of decoded
 * video in memory.
 */
const PIPELINE_DEPTH = 4;

type Readback = { buffer: Uint8Array; width: number; height: number; stride: number };

/**
 * The codec configuration boxes a visual sample entry may carry.
 *
 * mp4box types `Sample.description` as the whole sample-entry union, which has
 * no property common to every arm to narrow on, so the visual case is asserted
 * rather than tested - a video track's entry is one by definition. `write` is
 * loosened for the same reason: the boxes write to a stream type the public
 * DataStream is not declared to satisfy.
 */
type CodecConfigBoxes = Partial<
  Record<'avcC' | 'hvcC' | 'vpcC' | 'av1C', { write(stream: unknown): void }>
>;

/** The description a decoder needs for the codecs that carry their parameter
 * sets out of band (H.264/H.265) rather than in the stream. */
function codecDescription(sample: Sample): Uint8Array | undefined {
  const entry = sample.description as CodecConfigBoxes;
  const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
  if (!box) return undefined;

  // mp4box writes the box including its 8-byte header; the decoder wants only
  // the payload after it.
  const stream = new DataStream();
  box.write(stream);
  return new Uint8Array(stream.buffer, 8);
}

/** How long to wait between checks of the decoder's backlog. Polled rather than
 * driven by the `dequeue` event, which is not implemented everywhere WebCodecs
 * is - and an event that never fires would hang the worker outright, where a
 * poll costs a few milliseconds spread across thousands of frames. */
const DRAIN_POLL_MS = 5;

/**
 * Decodes every frame of a video and counts its scene transitions.
 *
 * The whole file is handed to mp4box at once rather than streamed. Indexing
 * needs the moov box, which in a file that was never prepared for streaming
 * sits at the end, so a streaming pass would buffer most of the file anyway.
 * Worth revisiting if a library of very large files makes memory a problem.
 */
async function computeSceneStats(
  file: File,
  threshold: number,
): Promise<{ result: SceneStatsResult; timings: SceneStatsTimings }> {
  const startedAt = performance.now();
  // keepMdatData must be on, or the media data is thrown away as it is parsed
  // and every sample reads back empty. It defaults to *false* in mp4box 2.x
  // (it was true in 1.x), and the only complaint is a console warning, so the
  // failure otherwise looks like an unreadable file rather than a wrong flag.
  const mp4 = createFile(true);
  const counter = new SceneCounter(threshold);

  let onTrack!: (track: Track) => void;
  let onFailure!: (error: Error) => void;
  const ready = new Promise<Track>((resolve, reject) => {
    onTrack = resolve;
    onFailure = reject;
  });

  let answered = false;

  mp4.onReady = (info) => {
    answered = true;
    const video = info.videoTracks[0];
    if (!video) onFailure(new Error('This file has no video track.'));
    else onTrack(video);
  };
  mp4.onError = (module, message) => {
    answered = true;
    onFailure(new Error(`${module}: ${message}`));
  };

  // appendBuffer builds the sample lists and fires onReady, both synchronously.
  // Deliberately no flush() anywhere in here: it ends with stream.cleanBuffers(),
  // which throws away the very bytes the samples are read out of.
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(await file.arrayBuffer(), 0));

  // mp4box parses ISO-BMFF only, and says nothing at all about a container it
  // does not recognise - no error, no ready. The library accepts .mkv and .webm
  // uploads, so without this an ordinary Matroska file would leave the promise
  // below pending forever and the queue slot with it.
  if (!answered) {
    throw new Error(
      `Could not read '${file.name}' as MP4. Local scene stats need an MP4 or MOV container; Matroska (.mkv, .webm) is not supported here.`,
    );
  }

  const track = await ready;

  // Pulled one at a time rather than pushed through onSamples. onSamples is
  // synchronous, so with the whole file already appended it would hand over
  // every sample in one go - the entire encoded stream held at once, with
  // nowhere to apply backpressure. Pulling lets each sample be decoded and
  // released before the next is read.
  const samples = mp4.getTrackSamplesInfo(track.id);
  if (!samples?.length) throw new Error('No video samples could be read from this file.');

  let copyMs = 0;
  let pixelMs = 0;
  let lastTimestamp = -Infinity;
  let decodeError: Error | null = null;

  /**
   * Frames waiting to be read back, and the readbacks already in flight.
   *
   * What the counting needs is *order*, not one-at-a-time: each frame is
   * differenced against the one before it. Reading back strictly serially met
   * that requirement but paid the full GPU-to-CPU round trip on every one of
   * however many thousand frames, with nothing overlapping it. So several
   * readbacks run at once into buffers of their own, and their results are
   * retired in the order they were started.
   */
  const decoded: VideoFrame[] = [];
  const readbacks: Promise<Readback>[] = [];
  // One buffer per pipeline slot, reused. A 1080p frame is 8MB as RGBA, so
  // allocating per frame would be a gigabyte of garbage a minute; a slot can
  // only be reused once its readback has been retired, which is what keeps the
  // reuse safe.
  const pool: Uint8Array[] = [];
  let poolCursor = 0;

  const startReadback = (frame: VideoFrame) => {
    try {
      // Order matters to the arithmetic, so an out-of-order frame would not be
      // slightly wrong - it would be wrong in a way nothing downstream could
      // detect. Decoders are expected to emit in presentation order; this says
      // so out loud rather than trusting it silently.
      if (frame.timestamp < lastTimestamp) {
        throw new Error('Decoder emitted frames out of presentation order.');
      }
      lastTimestamp = frame.timestamp;

      const rect = frame.visibleRect ?? {
        x: 0,
        y: 0,
        width: frame.codedWidth,
        height: frame.codedHeight,
      };
      const options = { format: 'RGBA' as const, rect };
      const size = frame.allocationSize(options);

      const slot = poolCursor;
      poolCursor = (poolCursor + 1) % PIPELINE_DEPTH;
      if (!pool[slot] || pool[slot].byteLength < size) pool[slot] = new Uint8Array(size);
      const buffer = pool[slot];

      const startedAt = performance.now();
      readbacks.push(
        frame
          .copyTo(buffer, options)
          .then((layout) => {
            copyMs += performance.now() - startedAt;
            return {
              buffer,
              width: rect.width,
              height: rect.height,
              stride: layout[0]?.stride ?? rect.width * 4,
            };
          })
          .finally(() => frame.close()),
      );
    } catch (error) {
      frame.close();
      throw error;
    }
  };

  /** Counts the oldest completed readback, freeing its slot for reuse. */
  const retireOldest = async () => {
    const head = readbacks.shift();
    if (!head) return;
    const { buffer, width, height, stride } = await head;
    const startedAt = performance.now();
    counter.pushRgba(buffer, width, height, stride);
    pixelMs += performance.now() - startedAt;
  };

  /** Keeps the readback pipeline as full as it is allowed to be. */
  const pump = async () => {
    while (decoded.length > 0) {
      if (readbacks.length >= PIPELINE_DEPTH) await retireOldest();
      startReadback(decoded.shift()!);
    }
  };

  const decoder = new VideoDecoder({
    // Only queued here: starting the readback needs to wait for a free slot,
    // and this callback cannot await.
    output: (frame) => decoded.push(frame),
    error: (error) => {
      decodeError ??= error instanceof Error ? error : new Error(String(error));
    },
  });

  const config: VideoDecoderConfig = {
    codec: track.codec,
    codedWidth: track.video?.width,
    codedHeight: track.video?.height,
    description: codecDescription(samples[0]),
  };

  /** Waits for the decoder to work through its backlog, giving up if it has
   * failed - otherwise a decoder that stopped consuming would spin here. */
  const drain = async () => {
    while (decoder.decodeQueueSize > RESUME_DECODE_QUEUE) {
      if (decodeError) throw decodeError;
      // Pumped here too, so waiting on the decoder is also spent reading frames
      // back rather than idling.
      await pump();
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }
  };

  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error(`This browser cannot decode '${track.codec}'.`);
  }
  decoder.configure(config);

  try {
    for (let index = 0; index < samples.length; index++) {
      if (decodeError) throw decodeError;

      const sample = mp4.getTrackSample(track.id, index);
      if (!sample?.data) {
        throw new Error(`Sample ${index} of ${samples.length} could not be read from this file.`);
      }

      decoder.decode(
        new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (sample.cts * 1_000_000) / sample.timescale,
          duration: (sample.duration * 1_000_000) / sample.timescale,
          data: sample.data,
        }),
      );

      // EncodedVideoChunk copies the bytes it is given, so mp4box's own copy can
      // go immediately. Without this it accumulates every sample it has handed
      // out, which is the whole encoded stream a second time over.
      mp4.releaseUsedSamples(track.id, index + 1);

      await pump();
      if (decoder.decodeQueueSize > MAX_DECODE_QUEUE) await drain();
    }

    await decoder.flush();
    // flush() resolves once every frame has been emitted, so this is the last of
    // them - read back what is left, then count what is still in flight.
    await pump();
    while (readbacks.length > 0) await retireOldest();
  } finally {
    // A frame holds GPU memory until it is closed, and on the error path these
    // never reached a readback to be closed by one.
    for (const frame of decoded.splice(0)) frame.close();
    for (const pending of readbacks.splice(0)) pending.catch(() => undefined);
    if (decoder.state !== 'closed') decoder.close();
  }

  if (decodeError) throw decodeError;

  // Fail rather than report zero. This is the bug the server has: its OpenCV
  // build cannot decode AV1, so it opens the container, reads no frames, and
  // returns a perfectly ordinary "0 scenes" - which is indistinguishable from a
  // genuinely static video and is cached as though it were measured. Two rows
  // of the golden corpus are that failure. A count nothing was counted from is
  // not a result.
  if (counter.frames === 0) {
    throw new Error(`Decoded no frames from this '${track.codec}' video.`);
  }

  const totalMs = performance.now() - startedAt;
  return {
    result: {
      // The server takes CAP_PROP_FRAME_COUNT / CAP_PROP_FPS. FFmpeg derives
      // that fps as samples over track duration, so the frame counts cancel and
      // this is the same number - without depending on every frame decoding.
      duration_secs: track.duration / track.timescale,
      scenes: counter.scenes,
    },
    timings: {
      frames: counter.frames,
      copy_secs: copyMs / 1000,
      pixels_secs: pixelMs / 1000,
      other_secs: (totalMs - copyMs - pixelMs) / 1000,
      total_secs: totalMs / 1000,
    },
  };
}

addEventListener('message', (event: MessageEvent<SceneStatsRequest>) => {
  const { file, threshold } = event.data;
  computeSceneStats(file, threshold)
    .then(({ result, timings }) =>
      postMessage({ ok: true, result, timings } satisfies SceneStatsResponse),
    )
    .catch((error: unknown) =>
      postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies SceneStatsResponse),
    );
});
