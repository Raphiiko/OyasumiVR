import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DMKnownDevice } from '../../../models/device-manager';
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

  const knownBeyond = (serial: string, maxBrightness: number) =>
    ({
      id: `OVR_HMD_${serial}`,
      deviceType: 'HMD',
      manufacturer: 'Bigscreen',
      settings: { model: 'BIGSCREEN_BEYOND', maxBrightness },
    }) as DMKnownDevice;

  it('uses the lowest known maximum until SteamVR reports the Beyond, and its own after', () => {
    const knownDevices = new BehaviorSubject([
      knownBeyond('BSB-TEST0001', 130),
      knownBeyond('BSB-TEST0002', 110),
    ]);
    const devices = new BehaviorSubject<OVRDevice[]>([]);
    const driver = new BigscreenBeyondHardwareBrightnessControlDriver(knownDevices, devices);
    expect(driver.getBrightnessBounds()[1]).toBe(110);
    devices.next([BEYOND]);
    expect(driver.getBrightnessBounds()[1]).toBe(130);
    devices.next([]);
    expect(driver.getBrightnessBounds()[1]).toBe(130);
  });
});
