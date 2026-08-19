import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedValue } from './cached-value';

const cacheStore = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../globals', () => ({ CACHE_STORE: cacheStore }));

beforeEach(() => {
  cacheStore.delete.mockReset();
  cacheStore.get.mockReset();
  cacheStore.set.mockReset();
});

describe('CachedValue', () => {
  it('waits for persisted state to load before clearing it', async () => {
    let finishLoad: () => void = () => {};
    cacheStore.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLoad = () =>
            resolve({
              value: 'cached',
              lastSet: Date.now(),
              ttl: 60_000,
            });
        })
    );
    cacheStore.delete.mockResolvedValue(undefined);
    const cache = new CachedValue<string>(undefined, 60_000, 'TEST');

    const clearing = cache.clear();
    await Promise.resolve();
    expect(cacheStore.delete).not.toHaveBeenCalled();

    finishLoad();
    await clearing;

    expect(cache.get()).toBeUndefined();
    expect(cacheStore.delete).toHaveBeenCalledWith('CachedValue_TEST');
  });

  it('deletes persisted state after its initial load fails', async () => {
    cacheStore.get.mockRejectedValue(new Error('LOAD_FAILED'));
    cacheStore.delete.mockResolvedValue(undefined);
    const cache = new CachedValue<string>(undefined, 60_000, 'TEST');
    await cache.waitForInitialisation();

    await cache.clear();

    expect(cacheStore.delete).toHaveBeenCalledWith('CachedValue_TEST');
  });

  it('handles a failed expired-entry deletion', async () => {
    cacheStore.get.mockResolvedValue({
      value: 'cached',
      lastSet: 0,
      ttl: 1,
    });
    cacheStore.delete.mockRejectedValue(new Error('DELETE_FAILED'));
    const cache = new CachedValue<string>(undefined, 60_000, 'TEST');
    await cache.waitForInitialisation();

    expect(cache.get()).toBeUndefined();
    await vi.waitFor(() => expect(cacheStore.delete).toHaveBeenCalledWith('CachedValue_TEST'));
  });
});
