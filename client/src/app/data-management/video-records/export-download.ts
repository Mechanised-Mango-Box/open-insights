/**
 * Somewhere to write an export as it is built, so it never has to exist in memory whole.
 *
 * Tried in order: the File System Access save dialog (Chromium), then a service worker download
 * (Firefox, and anything else with service workers - see public/export-download/sw.js). Null
 * when neither is available, e.g. a Firefox private window, which has no service workers; the
 * caller then falls back to an in-memory Blob.
 *
 * Rejects with an AbortError if the user dismisses the save dialog.
 */
export async function openExportSink(filename: string): Promise<WritableStream<Uint8Array> | null> {
  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker) {
    const handle = await picker({
      suggestedName: filename,
      types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }],
    });
    return handle.createWritable();
  }

  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    return await openServiceWorkerSink(filename);
  } catch (error) {
    console.warn('Streaming download unavailable, falling back to in-memory export:', error);
    return null;
  }
}

type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;

/** Whether exporting in this browser can stream to disk, for warning before a big export. */
export const canStreamExport = (): boolean =>
  'showSaveFilePicker' in window || ('serviceWorker' in navigator && window.isSecureContext);

const SCOPE = 'export-download/';
/** Firefox stops a service worker it considers idle after about 30 seconds. */
const KEEP_ALIVE_MS = 10_000;
/** How long the download manager gets to request the stream before it counts as not started. */
const START_TIMEOUT_MS = 15_000;

async function openServiceWorkerSink(filename: string): Promise<WritableStream<Uint8Array>> {
  const scope = new URL(SCOPE, document.baseURI).href;
  await navigator.serviceWorker.register(new URL('sw.js', scope).href, { scope });
  const registration = await navigator.serviceWorker.getRegistration(scope);
  const worker = await activeWorker(registration);

  const id = crypto.randomUUID();
  const channel = new MessageChannel();
  const port = channel.port1;

  // Every message the worker sends that the writable below is waiting on. 'pull' is counted
  // rather than flagged: the stream only ever has one outstanding, but a count cannot be
  // miscounted into a lost chunk if that ever changes.
  let pulls = 0;
  let cancelled = false;
  let wake: (() => void) | null = null;
  const waitForMessage = () => new Promise<void>((resolve) => (wake = resolve));

  const registered = new Promise<void>((resolve) => {
    port.onmessage = ({ data }) => {
      if (data.type === 'registered') resolve();
      else if (data.type === 'started') started();
      else if (data.type === 'pull') pulls++;
      else if (data.type === 'cancel') cancelled = true;
      wake?.();
    };
  });
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => (started = resolve));

  worker.postMessage({ type: 'register', id, filename }, [channel.port2]);
  await registered;

  // An iframe rather than navigating the page or clicking a link: if the worker somehow does not
  // answer, whatever the server sends instead lands out of sight rather than replacing the app.
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = new URL(encodeURIComponent(id), scope).href;
  document.body.appendChild(frame);

  const keepAlive = setInterval(() => worker.postMessage({ type: 'ping' }), KEEP_ALIVE_MS);
  const cleanUp = () => {
    clearInterval(keepAlive);
    // Removed later rather than now: taking the frame away can cancel the download it started.
    setTimeout(() => frame.remove(), 60_000);
  };

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('The download did not start.')), START_TIMEOUT_MS),
  );
  try {
    await Promise.race([startedPromise, timeout]);
  } catch (error) {
    cleanUp();
    port.close();
    throw error;
  }

  return new WritableStream<Uint8Array>({
    async write(chunk) {
      while (pulls === 0 && !cancelled) await waitForMessage();
      if (cancelled) throw new DOMException('The download was cancelled.', 'AbortError');
      pulls--;
      // Copied into a buffer of its own so it can be transferred: the chunk may be a view onto
      // a larger buffer the zip writer is still using.
      const buffer = chunk.slice().buffer;
      port.postMessage({ type: 'chunk', chunk: buffer }, [buffer]);
    },
    async close() {
      while (pulls === 0 && !cancelled) await waitForMessage();
      if (!cancelled) port.postMessage({ type: 'done' });
      cleanUp();
    },
    abort(reason) {
      if (!cancelled) {
        port.postMessage({ type: 'error', message: String(reason?.message ?? reason) });
      }
      cleanUp();
    },
  });
}

/** The registration's worker once it is active, waiting through install/activate if needed. */
function activeWorker(registration: ServiceWorkerRegistration | undefined): Promise<ServiceWorker> {
  if (!registration) return Promise.reject(new Error('Service worker did not register.'));
  if (registration.active) return Promise.resolve(registration.active);

  const installing = registration.installing ?? registration.waiting;
  if (!installing) return Promise.reject(new Error('Service worker has no worker to wait for.'));
  return new Promise((resolve, reject) => {
    installing.addEventListener('statechange', () => {
      if (installing.state === 'activated') resolve(installing);
      else if (installing.state === 'redundant') {
        reject(new Error('Service worker failed to activate.'));
      }
    });
  });
}
