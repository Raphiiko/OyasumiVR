import { describe, expect, it, vi } from 'vitest';
import { BrightnessTransitionTask } from './brightness-transition';
import { CCTTransitionTask } from '../cct-control/cct-transition';

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));

const brightnessTransition = (
  setBrightness: (percentage: number) => Promise<boolean | void>,
  duration = 0
) =>
  new BrightnessTransitionTask(
    'HARDWARE',
    setBrightness,
    async () => 100,
    async () => [0, 100],
    50,
    duration
  );

describe('transition tasks', () => {
  it('fail the brightness transition when the headset refuses the target twice', async () => {
    const setBrightness = vi.fn(async () => false);
    const task = brightnessTransition(setBrightness);

    await expect(task.start()).rejects.toThrow('did not accept brightness 50%');
    expect(task.isError()).toBe(true);
    expect(setBrightness).toHaveBeenLastCalledWith(50, expect.anything());
  });

  it('fail the colour temperature transition when the headset refuses the target twice', async () => {
    const setCCT = vi.fn(async () => false);
    const task = new CCTTransitionTask(setCCT, async () => 6500, 4000, 0);

    await expect(task.start()).rejects.toThrow('did not accept colour temperature 4000K');
    expect(task.isError()).toBe(true);
  });

  it('continue past refused intermediate values', async () => {
    const setBrightness = vi.fn(async (percentage: number) => percentage === 50);
    const task = brightnessTransition(setBrightness, 100);

    await expect(task.start()).resolves.toBeUndefined();
    expect(task.isComplete()).toBe(true);
    expect(setBrightness.mock.calls.length).toBeGreaterThan(2);
  });

  it('complete when the headset refuses the target once', async () => {
    let targetRefused = false;
    const setCCT = vi.fn(async (cct: number) => {
      if (cct !== 4000 || targetRefused) return true;
      targetRefused = true;
      return false;
    });
    const task = new CCTTransitionTask(setCCT, async () => 6500, 4000, 0);

    await expect(task.start()).resolves.toBeUndefined();
    expect(task.isComplete()).toBe(true);
  });

  it('complete when the setter reports nothing', async () => {
    const task = new BrightnessTransitionTask(
      'SOFTWARE',
      async () => {},
      async () => 100,
      async () => [0, 100],
      50,
      0
    );

    await expect(task.start()).resolves.toBeUndefined();
    expect(task.isComplete()).toBe(true);
  });
});
