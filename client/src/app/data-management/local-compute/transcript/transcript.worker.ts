/// <reference lib="webworker" />
import { pipeline } from '@huggingface/transformers';
import { TranscriptSegment } from '../../video-records/Dataset';
import { AsrOutput, toTranscriptSegments, wholeAsOneSegment } from './transcript-segments';

/**
 * The English-only tiny model. Its tier is part of TRANSCRIPT_PRODUCER_LOCAL,
 * so changing it here without changing that would leave transcripts made by the
 * old one looking current.
 */
const MODEL = 'onnx-community/whisper-tiny.en';
const DTYPE = 'q8';

/** Whisper's window. The stride is the overlap between consecutive windows,
 * which is what lets a word spoken across a boundary be recovered rather than
 * clipped in half. */
const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;

export type TranscriptRequest = { pcm: Float32Array; duration_secs: number };

export type TranscriptResponse =
  | { kind: 'ready' }
  | { kind: 'progress'; label: string; loaded: number; total: number }
  | { kind: 'done'; segments: TranscriptSegment[] }
  | { kind: 'error'; error: string };

const send = (message: TranscriptResponse) => postMessage(message);

/**
 * The loaded model, kept for the life of the worker.
 *
 * This is the whole reason transcription uses one long-lived worker rather than
 * one per video, as scene stats does: fetching the weights and building the
 * WebGPU session costs seconds, and paying that per file across a batch of
 * thirty would dwarf the transcription itself.
 */
let recogniser: Promise<unknown> | null = null;

function load(): Promise<unknown> {
  recogniser ??= pipeline('automatic-speech-recognition', MODEL, {
    // WebGPU only. The WASM fallback needs SharedArrayBuffer for threading,
    // which needs cross-origin isolation, which a GitHub Pages site cannot
    // send - and single-threaded WASM is slower than real time.
    device: 'webgpu',
    dtype: DTYPE,
    progress_callback: (report: unknown) => {
      const { status, file, loaded, total } = (report ?? {}) as {
        status?: string;
        file?: string;
        loaded?: number;
        total?: number;
      };
      if (status === 'progress' && total) {
        send({ kind: 'progress', label: file ?? MODEL, loaded: loaded ?? 0, total });
      }
    },
  });
  return recogniser;
}

async function transcribe({ pcm, duration_secs }: TranscriptRequest): Promise<TranscriptSegment[]> {
  // The pipeline's own typings do not describe the chunked long-form result, so
  // the shape is asserted here and pinned by transcript-segments.spec.ts.
  const asr = (await load()) as (
    audio: Float32Array,
    options: Record<string, unknown>,
  ) => Promise<AsrOutput>;

  const output = await asr(pcm, {
    chunk_length_s: CHUNK_LENGTH_S,
    stride_length_s: STRIDE_LENGTH_S,
    return_timestamps: true,
  });

  const segments = toTranscriptSegments(output, duration_secs);
  // A model that returned text but no chunk timings would otherwise read as an
  // empty transcript, throwing away a perfectly good one over its timestamps.
  return segments.length > 0 ? segments : wholeAsOneSegment(output, duration_secs);
}

addEventListener('message', (event: MessageEvent<TranscriptRequest>) => {
  transcribe(event.data)
    .then((segments) => send({ kind: 'done', segments }))
    .catch((error: unknown) =>
      send({ kind: 'error', error: error instanceof Error ? error.message : String(error) }),
    );
});
