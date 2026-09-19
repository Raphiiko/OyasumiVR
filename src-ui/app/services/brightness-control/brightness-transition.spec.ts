import { describe, expect, it, vi } from 'vitest';
import { BrightnessTransitionTask } from './brightness-transition';
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
describe('local hardware transitions', () => {
  it('keeps local interpolation for drivers without delegation', async () => {
    vi.useFakeTimers();
    try {
      const set = vi.fn(async () => {});
      const task = new BrightnessTransitionTask(
        'HARDWARE',
        set,
        async () => 20,
        async () => [20, 160],
        100,
        1000
      );
      const finished = task.start();
      await vi.advanceTimersByTimeAsync(500);
      expect(set.mock.calls.length).toBeGreaterThan(20);
      expect((set.mock.calls.at(-1) as unknown as [number])[0]).toBeCloseTo(60, 0);
      await vi.advanceTimersByTimeAsync(600);
      await finished;
      expect(set).toHaveBeenLastCalledWith(100, expect.anything());
      expect(task.isComplete()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('cancels without a logging reason and never completes the cancelled task', async () => {
    vi.useFakeTimers();
    try {
      const set = vi.fn(async () => {});
      const task = new BrightnessTransitionTask(
        'HARDWARE',
        set,
        async () => 20,
        async () => [20, 160],
        100,
        1000,
        { logReason: null }
      );
      const finished = task.start();
      task.cancel();
      await vi.advanceTimersByTimeAsync(1100);
      await finished;
      expect(set).not.toHaveBeenCalled();
      expect(task.isCancelled()).toBe(true);
      expect(task.isComplete()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
