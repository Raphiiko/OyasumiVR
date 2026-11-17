import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DMKnownDevice } from '../../../models/device-manager';
import { APP_SETTINGS_DEFAULT } from '../../../models/settings';
import type { OVRDevice } from '../../../models/ovr-device';
import { BigscreenBeyondHardwareBrightnessControlDriver } from './bigscreen-beyond-hardware-brightness-control-driver';

const { usb } = vi.hoisted(() => ({
  usb: { connected: false, onConnected: (_connected: boolean) => {} },
}));

vi.mock('src-ui/app/bindings', () => ({
  commands: {
    bigscreenBeyondIsConnected: vi.fn(async () => usb.connected),
    bigscreenBeyondGetSavedPreferences: vi.fn(async () => ({ status: 'ok', data: null })),
    bigscreenBeyondSetBrightness: vi.fn(async () => ({ status: 'ok', data: null })),
  },
  events: {
    bigscreenBeyondConnectedEvent: {
      listen: vi.fn(async (handler: (event: { payload: boolean }) => void) => {
        usb.onConnected = (connected) => {
          usb.connected = connected;
          handler({ payload: connected });
        };
        return () => {};
      }),
    },
  },
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

  const settings = (bigscreenBeyondUnsafeBrightness = false) =>
    new BehaviorSubject({
      ...structuredClone(APP_SETTINGS_DEFAULT),
      bigscreenBeyondUnsafeBrightness,
    });

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
    const driver = new BigscreenBeyondHardwareBrightnessControlDriver(
      knownDevices,
      devices,
      settings()
    );
    expect(driver.getBrightnessBounds()[1]).toBe(110);
    devices.next([BEYOND]);
    expect(driver.getBrightnessBounds()[1]).toBe(130);
    devices.next([]);
    expect(driver.getBrightnessBounds()[1]).toBe(130);
  });

  it('uses the lowest known maximum again after the USB connection ends', async () => {
    const knownDevices = new BehaviorSubject([
      knownBeyond('BSB-TEST0001', 150),
      knownBeyond('BSB-TEST0002', 110),
    ]);
    const devices = new BehaviorSubject<OVRDevice[]>([BEYOND]);
    usb.connected = true;
    const driver = new BigscreenBeyondHardwareBrightnessControlDriver(
      knownDevices,
      devices,
      settings()
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.getBrightnessBounds()[1]).toBe(150);

    // the Beyond is unplugged while SteamVR runs, then another one is plugged in over USB
    usb.onConnected(false);
    devices.next([{ ...BEYOND, isConnected: false }]);
    usb.onConnected(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(driver.getBrightnessBounds()[1]).toBe(110);
  });

  it('limits a Beyond maximum above 150% to 150% while unsafe brightness is off', () => {
    const appSettings = settings();
    const driver = new BigscreenBeyondHardwareBrightnessControlDriver(
      new BehaviorSubject([knownBeyond('BSB-TEST0001', 200)]),
      new BehaviorSubject<OVRDevice[]>([BEYOND]),
      appSettings
    );
    expect(driver.getBrightnessBounds()[1]).toBe(150);
    appSettings.next({ ...appSettings.value, bigscreenBeyondUnsafeBrightness: true });
    expect(driver.getBrightnessBounds()[1]).toBe(200);
  });
});
