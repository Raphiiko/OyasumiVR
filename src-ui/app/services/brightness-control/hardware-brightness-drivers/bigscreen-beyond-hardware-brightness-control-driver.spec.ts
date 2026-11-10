import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../../models/settings';
import type { OVRDevice } from '../../../models/ovr-device';
import { BigscreenBeyondHardwareBrightnessControlDriver } from './bigscreen-beyond-hardware-brightness-control-driver';

vi.mock('src-ui/app/bindings', () => ({
  commands: { bigscreenBeyondIsConnected: vi.fn(async () => false) },
  events: { bigscreenBeyondConnectedEvent: { listen: vi.fn(async () => () => {}) } },
}));
vi.mock('@tauri-apps/plugin-log', () => ({ warn: vi.fn() }));

const BEYOND = {
  index: 0,
  class: 'HMD',
  isConnected: true,
  manufacturerName: 'Bigscreen',
  modelNumber: 'Beyond',
  serialNumber: 'BSB-TEST0001',
} as OVRDevice;

describe('BigscreenBeyondHardwareBrightnessControlDriver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps its own maximum after SteamVR stops reporting the Beyond', () => {
    const settings = new BehaviorSubject({
      ...structuredClone(APP_SETTINGS_DEFAULT),
      bigscreenBeyondMaxBrightness: 150,
      hmdSettings: { 'OVR_HMD_BSB-TEST0001': { maxBrightness: 100 } },
    });
    const devices = new BehaviorSubject<OVRDevice[]>([]);
    const driver = new BigscreenBeyondHardwareBrightnessControlDriver(settings, devices);
    expect(driver.getBrightnessBounds()[1]).toBe(150);
    devices.next([BEYOND]);
    expect(driver.getBrightnessBounds()[1]).toBe(100);
    devices.next([]);
    expect(driver.getBrightnessBounds()[1]).toBe(100);
  });
});
