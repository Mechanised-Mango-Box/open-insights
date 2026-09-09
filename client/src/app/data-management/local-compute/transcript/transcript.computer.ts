import { signal } from '@angular/core';
import { Computer } from '../compute-queue.service';
import {
  TranscriptStats,
  TranscriptSegment,
  computeTranscriptStats,
} from '../../video-records/Dataset';
import type { TranscriptRequest, TranscriptResponse } from './transcript.worker';

/** What Whisper expects: 16kHz mono. */
const SAMPLE_RATE = 16000;

/**
 * Everything about this implementation that could move the numbers.
 *
 * The tier is the load-bearing part: the server's corpus was made by
 * faster-whisper at small.en or turbo, and tiny.en is a far smaller model. A
 * result stamped with this reads as absent against one of those, which is the
 * intended behaviour - word counts feed wpm, and mixing two models' counts into
 * one analysis would shift a feature for every row.
 */
export const TRANSCRIPT_PRODUCER_LOCAL = 'transformers.js/whisper-tiny.en/q8/en';

/** How far the model download has got, for the UI to show during a first run. */
export const transcriptModelProgress = signal<{ label: string; ratio: number } | null>(null);

/**
 * Whether transcription can run here at all.
 *
 * A cheap synchronous test for the API. Whether the adapter is actually usable
 * is only known once one is requested, which happens in the worker - a machine
 * with a blocklisted GPU passes this and fails there, with a message saying so.
 */
export function supportsTranscript(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Decodes a file's audio to the mono 16kHz the model wants.
 *
 * On the main thread because the Web Audio API is not exposed to workers -
 * decodeAudioData does the container parsing, codec decode and resample in one
 * call, and reimplementing that over WebCodecs to move it off-thread would be a
 * lot of machinery for work the browser already does natively.
 */
async function extractAudio(file: File): Promise<{ pcm: Float32Array; duration_secs: number }> {
  // decodeAudioData resamples to the context's rate, so asking for 16kHz here
  // is what avoids resampling it again afterwards.
  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: 1,
    sampleRate: SAMPLE_RATE,
  });

  let audio: AudioBuffer;
  try {
    audio = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(`Could not decode any audio from '${file.name}'.`);
  }

  const duration_secs = audio.duration;
  if (audio.numberOfChannels === 1) {
    return { pcm: audio.getChannelData(0), duration_secs };
  }

  // Averaged rather than taking the left channel: a video mixed with speech on
  // one side would otherwise transcribe from silence.
  const mixed = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    for (let i = 0; i < mixed.length; i++) mixed[i] += data[i];
  }
  for (let i = 0; i < mixed.length; i++) mixed[i] /= audio.numberOfChannels;
  return { pcm: mixed, duration_secs };
}

/**
 * The worker, kept alive between videos so the model is loaded once.
 *
 * Safe to share because the compute queue runs transcription one at a time -
 * WebGPU has a single device, so a second concurrent run would contend for it
 * rather than add throughput.
 */
let worker: Worker | null = null;

function getWorker(): Worker {
  worker ??= new Worker(new URL('./transcript.worker', import.meta.url), { type: 'module' });
  return worker;
}

/** Drops the worker so the next run starts clean. Used when one fails, since a
 * failed WebGPU session does not necessarily recover. */
function resetWorker(): void {
  worker?.terminate();
  worker = null;
}

function run(request: TranscriptRequest): Promise<TranscriptSegment[]> {
  return new Promise((resolve, reject) => {
    const active = getWorker();

    const finish = (settle: () => void) => {
      active.onmessage = null;
      active.onerror = null;
      transcriptModelProgress.set(null);
      settle();
    };

    active.onmessage = ({ data }: MessageEvent<TranscriptResponse>) => {
      switch (data.kind) {
        case 'progress':
          transcriptModelProgress.set({
            label: data.label,
            ratio: data.total > 0 ? data.loaded / data.total : 0,
          });
          return;
        case 'done':
          finish(() => resolve(data.segments));
          return;
        case 'error':
          resetWorker();
          finish(() => reject(new Error(data.error)));
          return;
      }
    };

    active.onerror = (event) => {
      resetWorker();
      finish(() => reject(new Error(event.message || 'Transcription worker failed.')));
    };

    // The samples are transferred rather than copied - a 20-minute video is
    // ~77MB of them, and the main thread has no further use for it.
    active.postMessage(request, [request.pcm.buffer]);
  });
}

export const transcriptComputer: Computer<'transcript'> = {
  producer: TRANSCRIPT_PRODUCER_LOCAL,

  async compute(file: File): Promise<TranscriptStats & { segments: TranscriptSegment[] }> {
    const { pcm, duration_secs } = await extractAudio(file);
    const segments = await run({ pcm, duration_secs });
    // Reuses the same counting the rest of the app does, so a locally-made
    // transcript's stats cannot drift from an imported one's.
    return { segments, ...computeTranscriptStats({ segments }) };
  },
};
