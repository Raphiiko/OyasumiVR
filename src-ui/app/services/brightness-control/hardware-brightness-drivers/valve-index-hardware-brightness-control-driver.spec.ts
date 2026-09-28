import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../../models/settings';
import type { OVRDevice } from '../../../models/ovr-device';
import type { OpenVRStatus } from '../../openvr.service';
import { ValveIndexHardwareBrightnessControlDriver } from './valve-index-hardware-brightness-control-driver';

vi.mock('@tauri-apps/plugin-log', () => ({ warn: vi.fn() }));

const INDEX = { class: 'HMD', manufacturerName: 'Valve', modelNumber: 'Index' } as OVRDevice;

/** Gain for a percentage below 100, by the Index's gamma curve. */
const gainFor = (percentage: number) => Math.pow(percentage / 100, 2.2);

/** A driver on an Index whose SteamVR holds `initialGain`, with writes that wait for `release`. */
function setup(initialGain = 1) {
  const status = new BehaviorSubject<OpenVRStatus>('INITIALIZED');
  const devices = new BehaviorSubject<OVRDevice[]>([INDEX]);
  const analogGainUpdates = new Subject<number>();
  let gain = initialGain;
  const releases: (() => void)[] = [];
  const setAnalogGain = vi.fn(
    (value: number) =>
      new Promise<void>((resolve) =>
        releases.push(() => {
          gain = value;
          resolve();
        })
      )
  );
  const getAnalogGain = vi.fn(async () => gain);
  const settings = structuredClone(APP_SETTINGS_DEFAULT);
  settings.valveIndexMaxBrightness = 150;
  const driver = new ValveIndexHardwareBrightnessControlDriver(new BehaviorSubject(settings), {
    status,
    devices,
    analogGainUpdates,
    getAnalogGain,
    setAnalogGain,
  });
  const updates: number[] = [];
  driver.brightnessUpdates.subscribe((value) => updates.push(value));
  /** SteamVR changes the gain and reports it, as its own brightness slider does. */
  const outsideChange = (value: number) => {
    gain = value;
    analogGainUpdates.next(value);
  };
  /** Lets the oldest waiting write reach SteamVR. */
  const release = async () => {
    releases.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
  };
  return {
    status,
    devices,
    analogGainUpdates,
    driver,
    updates,
    getAnalogGain,
    setAnalogGain,
    outsideChange,
    release,
  };
}

describe('ValveIndexHardwareBrightnessControlDriver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the gain SteamVR holds once the Index is available', async () => {
    const h = setup(gainFor(60));
    await vi.advanceTimersByTimeAsync(500);
    expect(await firstValueFrom(h.driver.isAvailable())).toBe(true);
    expect(h.updates).toEqual([60]);
    expect(h.setAnalogGain).not.toHaveBeenCalled();
  });

  it('adopts a change made outside OyasumiVR without writing it back', async () => {
    const h = setup();
    await vi.advanceTimersByTimeAsync(500);
    h.outsideChange(gainFor(45));
    h.outsideChange(1.3);
    expect(h.updates).toEqual([100, 45, 130]);
    expect(h.setAnalogGain).not.toHaveBeenCalled();
  });

  it('shows a value past the maximum brightness clamped', async () => {
    const h = setup();
    await vi.advanceTimersByTimeAsync(500);
    h.outsideChange(1.6);
    expect(h.updates.at(-1)).toBe(150);
  });

  it('skips reports while the Index is unavailable', async () => {
    const h = setup();
    await vi.advanceTimersByTimeAsync(500);
    h.status.next('INACTIVE');
    await vi.advanceTimersByTimeAsync(0);
    h.outsideChange(gainFor(45));
    expect(h.updates).toEqual([100]);
  });

  it('ignores the echo of its own write and shows the written value', async () => {
    const h = setup();
    await vi.advanceTimersByTimeAsync(500);
    const set = h.driver.setBrightnessPercentage(70);
    h.analogGainUpdates.next(gainFor(70));
    await h.release();
    await set;
    expect(h.updates).toEqual([100, 70]);
  });

  it('shows a change SteamVR took during the write, instead of the written value', async () => {
    const h = setup();
    await vi.advanceTimersByTimeAsync(500);
    // SteamVR's slider sets 120% right after the write lands
    h.setAnalogGain.mockImplementationOnce(async () => h.outsideChange(1.2));
    await h.driver.setBrightnessPercentage(80);
    expect(h.updates).toEqual([100, 120]);
  });

  it('reads the gain again when SteamVR changes it during the read-back', async () => {
    const h = setup();
    await vi.advanceTimersByTimeAsync(500);
    h.setAnalogGain.mockImplementationOnce(async () => {});
    // the read-back samples 100%, then SteamVR's slider sets 120% before the reply arrives
    h.getAnalogGain.mockImplementationOnce(async () => {
      const sampled = 1;
      h.outsideChange(1.2);
      return sampled;
    });
    await h.driver.setBrightnessPercentage(80);
    expect(h.updates).toEqual([100, 120]);
  });

  it('keeps a transition from being pulled back by a late echo of an earlier step', async () => {
    const h = setup();
    await vi.advanceTimersByTimeAsync(500);
    const steps = [90, 80, 70].map((step) => h.driver.setBrightnessPercentage(step));
    // the echo of the first step arrives while the newer steps wait
    h.analogGainUpdates.next(gainFor(90));
    await h.release();
    await h.release();
    await Promise.all(steps);
    expect(h.setAnalogGain.mock.calls.map(([gain]) => gain)).toEqual([gainFor(90), gainFor(70)]);
    expect(h.updates).toEqual([100, 70]);
  });
});
