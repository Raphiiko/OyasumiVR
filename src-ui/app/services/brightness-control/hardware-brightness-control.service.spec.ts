import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { APP_SETTINGS_DEFAULT } from '../../models/settings';
import { OVRDevice } from '../../models/ovr-device';
import { HardwareBrightnessControlService } from './hardware-brightness-control.service';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => false) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
type Dependencies = ConstructorParameters<typeof HardwareBrightnessControlService>;

const UNSUPPORTED_HMD: Partial<OVRDevice> = {
  index: 0,
  class: 'HMD',
  manufacturerName: 'Example',
  modelNumber: 'Headset',
  displaySupportsAnalogGain: true,
  displayMinAnalogGain: 0.2,
  displayMaxAnalogGain: 0.8,
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
// the service reads a newly available driver's level 500 ms after it appears
const firstFetch = () => new Promise((resolve) => setTimeout(resolve, 600));

function setup() {
  const settings = new BehaviorSubject({
    ...APP_SETTINGS_DEFAULT,
    hardwareBrightnessOnUnsupportedHmds: true,
  });
  const devices = new BehaviorSubject<Partial<OVRDevice>[]>([UNSUPPORTED_HMD]);
  const status = new BehaviorSubject('INITIALIZED');
  let analogGain = 0.8;
  const setAnalogGain = vi.fn(async (value: number) => {
    analogGain = value;
  });
  const openvr = {
    status,
    devices,
    getAnalogGain: async () => analogGain,
    setAnalogGain,
  };
  const service = new HardwareBrightnessControlService(
    openvr as unknown as Dependencies[0],
    { settings } as unknown as Dependencies[1]
  );
  const enable = (value: boolean) =>
    settings.next({ ...settings.value, hardwareBrightnessOnUnsupportedHmds: value });
  return { service, devices, status, enable, setAnalogGain, analogGain: () => analogGain };
}

describe('HardwareBrightnessControlService with the generic SteamVR analog gain driver', () => {
  it('restores the maximum gain when the option is turned off', async () => {
    const h = setup();
    await settle();
    expect(await firstValueFrom(h.service.driverIsAvailable)).toBe(true);
    await h.service.setBrightness(60);
    expect(h.analogGain()).toBeCloseTo(0.5);

    h.enable(false);
    await settle();

    expect(await firstValueFrom(h.service.driverIsAvailable)).toBe(false);
    expect(h.analogGain()).toBeCloseTo(0.8);
  });

  it('dims again when the option is turned back on', async () => {
    const h = setup();
    await settle();
    await h.service.setBrightness(60);
    h.enable(false);
    await settle();

    h.enable(true);
    await settle();
    await h.service.setBrightness(60);

    expect(h.analogGain()).toBeCloseTo(0.5);
  });

  it('raises the gain after SteamVR restarts with the headset still dimmed', async () => {
    const h = setup();
    await settle();
    await h.service.setBrightness(60);
    h.status.next('STOPPED');
    await settle();
    expect(h.analogGain()).toBeCloseTo(0.5);

    h.status.next('INITIALIZED');
    await settle();
    await h.service.setBrightness(100);

    expect(h.analogGain()).toBeCloseTo(0.8);
  });

  it('reapplies the brightness when the active headset reports a new range', async () => {
    const h = setup();
    h.devices.next([
      { ...UNSUPPORTED_HMD, displayMinAnalogGain: undefined, displayMaxAnalogGain: undefined },
    ]);
    await settle();
    await h.service.setBrightness(60);
    expect(h.analogGain()).toBeCloseTo(0.5);

    h.devices.next([{ ...UNSUPPORTED_HMD, displayMinAnalogGain: 0.2, displayMaxAnalogGain: 0.4 }]);
    await settle();

    expect(h.analogGain()).toBeCloseTo(0.3);
    expect(h.service.brightness).toBe(60);
  });

  it('shows the level of the headset driver that takes over', async () => {
    const h = setup();
    await h.service.init();
    await firstFetch();
    await h.service.setBrightness(60);
    h.setAnalogGain.mockClear();

    h.devices.next([{ ...UNSUPPORTED_HMD, manufacturerName: 'Valve', modelNumber: 'Index' }]);
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(h.setAnalogGain).not.toHaveBeenCalled();
    expect(h.service.brightness).toBe(await h.service.driverValveIndex.getBrightnessPercentage());
  });

  it('keeps the headset driver clamp when it takes over below its range', async () => {
    const h = setup();
    await h.service.init();
    await firstFetch();
    await h.service.setBrightness(30);

    h.devices.next([{ ...UNSUPPORTED_HMD, manufacturerName: 'SIE', modelNumber: 'PS VR2' }]);
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(h.service.brightness).toBe(50);
    expect(await h.service.driverPSVR2.getBrightnessPercentage()).toBe(50);
  });

  it('shows the level of a Bigscreen Beyond that connects while the generic driver is active', async () => {
    const beyondConnected = vi.mocked(listen).mock.calls.length;
    const h = setup();
    const [, onBeyondConnected] = vi
      .mocked(listen)
      .mock.calls.slice(beyondConnected)
      .find(([event]) => event === 'BIGSCREEN_BEYOND_CONNECTED')!;
    await h.service.init();
    await firstFetch();
    await h.service.setBrightness(60);

    onBeyondConnected({ payload: true } as Parameters<typeof onBeyondConnected>[0]);
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(h.service.brightness).toBe(100);
    expect(await h.service.driverBigscreenBeyond.getBrightnessPercentage()).toBe(100);
  });
});
