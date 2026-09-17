/**
 * Video records keep their File inside IndexedDB, so a library of lecture videos
 * is gigabytes of browser storage. Without persistence Firefox caps a site at
 * 10 GB, and a write past that fails with QuotaExceededError - the one failure an
 * import should survive rather than stop at.
 */

export const isQuotaExceeded = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'QuotaExceededError';

/**
 * Asks for storage the browser will not evict, which also lifts Firefox's limit
 * to a share of the disk. Firefox prompts for it; Chromium decides silently.
 *
 * Never throws: refusal, an insecure context, or a browser without the API all
 * just leave the import on the quota it already had.
 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
};
