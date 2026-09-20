import { describe, expect, it, vi } from 'vitest';
import { AwaitableEventSource } from './awaitable-event';

describe('AwaitableEventSource', () => {
  it('waits for every listener and reports failures', async () => {
    const source = new AwaitableEventSource<number>();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    const sibling = vi.fn();

    source.event.subscribe(() => pending);
    source.event.subscribe(() => {
      throw new Error('failed');
    });
    source.event.subscribe(sibling);

    let settled = false;
    const emission = source.emit(1).then((results) => {
      settled = true;
      return results;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(sibling).toHaveBeenCalledWith(1);

    finish();
    const results = await emission;
    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('stops notifying an unsubscribed listener', async () => {
    const source = new AwaitableEventSource<void>();
    const listener = vi.fn();
    const unsubscribe = source.event.subscribe(listener);

    unsubscribe();
    await source.emit();

    expect(listener).not.toHaveBeenCalled();
  });
});
