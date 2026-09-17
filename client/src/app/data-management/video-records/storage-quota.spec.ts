import { afterEach, describe, expect, it, vi } from 'vitest';
import { isQuotaExceeded, requestPersistentStorage } from './storage-quota';

describe('isQuotaExceeded', () => {
  it('recognises the quota DOMException', () => {
    const error = new DOMException(
      'The current transaction exceeded its quota limitations.',
      'QuotaExceededError',
    );
    expect(isQuotaExceeded(error)).toBe(true);
  });

  it('rejects other errors', () => {
    expect(isQuotaExceeded(new DOMException('gone', 'NotFoundError'))).toBe(false);
    expect(isQuotaExceeded(new Error('QuotaExceededError'))).toBe(false);
    expect(isQuotaExceeded(undefined)).toBe(false);
  });
});

describe('requestPersistentStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is false without the storage API', async () => {
    vi.stubGlobal('navigator', {});
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('does not ask again when already persisted', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => true, persist } });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks, and reports the answer', async () => {
    const persist = vi.fn(async () => false);
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } });
    expect(await requestPersistentStorage()).toBe(false);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('swallows a throwing persist', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => false,
        persist: async () => {
          throw new Error('insecure');
        },
      },
    });
    expect(await requestPersistentStorage()).toBe(false);
  });
});
