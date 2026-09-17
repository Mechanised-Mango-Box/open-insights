/*
 * Streams an export zip from the page to the browser's download manager.
 *
 * Firefox has no showSaveFilePicker, and the only other way to save a file - a Blob behind an
 * object URL - needs the whole file in memory first, which a library of video does not fit in.
 * A download a service worker answers with a ReadableStream is written to disk as it arrives,
 * so this worker sits between the two: the page registers a download over a MessagePort
 * (see export-download.ts), opens export-download/<id>, and each chunk the download manager
 * pulls is asked of the page in turn. The pull is what paces the page, so memory stays at
 * about one chunk however large the zip is.
 *
 * Scoped to export-download/ so it never sees a request the app itself makes.
 */

/** Downloads registered by a page but not yet opened, by id. */
const pending = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const message = event.data;
  // 'ping' needs no handling: receiving it is the point, as each message event keeps the
  // worker from being stopped as idle partway through a long download.
  if (message?.type !== 'register') return;

  const [port] = event.ports;
  pending.set(message.id, { filename: message.filename, port });
  port.postMessage({ type: 'registered' });
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const id = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/') + 1));
  const download = pending.get(id);
  if (!download) return;
  // One-shot: a second request for the same id (a retry from the download manager) would
  // find the page's stream already consumed.
  pending.delete(id);

  const { filename, port } = download;
  port.postMessage({ type: 'started' });

  let settle = null;
  const stream = new ReadableStream({
    pull(controller) {
      return new Promise((resolve) => {
        settle = resolve;
        port.onmessage = ({ data }) => {
          if (data.type === 'chunk') {
            controller.enqueue(new Uint8Array(data.chunk));
          } else if (data.type === 'done') {
            controller.close();
            port.close();
          } else if (data.type === 'error') {
            controller.error(new Error(data.message));
            port.close();
          }
          settle = null;
          resolve();
        };
        port.postMessage({ type: 'pull' });
      });
    },
    cancel() {
      port.postMessage({ type: 'cancel' });
      port.close();
      settle?.();
    },
  });

  event.respondWith(
    new Response(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    }),
  );
});
