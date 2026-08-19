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
});
