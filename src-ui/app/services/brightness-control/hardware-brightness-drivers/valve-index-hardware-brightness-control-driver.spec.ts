import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../../models/settings';
import { OVRDevice } from '../../../models/ovr-device';
import { OpenVRService } from '../../openvr.service';
import { ValveIndexHardwareBrightnessControlDriver } from './valve-index-hardware-brightness-control-driver';

const VALVE_INDEX = { manufacturerName: 'Valve', modelNumber: 'Index' };

function createDriver(hmd: Partial<OVRDevice>, analogGain: number | null = 1) {
  const openvr = {
    status: new BehaviorSubject('INITIALIZED'),
    devices: new BehaviorSubject([{ index: 0, class: 'HMD', ...hmd }]),
    getAnalogGain: async () => {
      if (analogGain === null) throw new Error('no analogGain value');
      return analogGain;
    },
    setAnalogGain: async (value: number) => {
      analogGain = value;
    },
  } as unknown as OpenVRService;
  const settings = new BehaviorSubject({ ...APP_SETTINGS_DEFAULT, valveIndexMaxBrightness: 160 });
  const driver = new ValveIndexHardwareBrightnessControlDriver(settings, openvr);
  return { driver, analogGain: () => analogGain };
}

describe('ValveIndexHardwareBrightnessControlDriver', () => {
  it('is available only for the Valve Index', async () => {
    expect(await firstValueFrom(createDriver(VALVE_INDEX).driver.isAvailable())).toBe(true);
    const other = createDriver({ manufacturerName: 'SIE', modelNumber: 'PS VR2' });
    expect(await firstValueFrom(other.driver.isAvailable())).toBe(false);
  });

  it('maps brightness along the gamma curve up to 100% and linearly into overdrive', async () => {
    const { driver, analogGain } = createDriver(VALVE_INDEX);
    await firstValueFrom(driver.isAvailable());
    await driver.setBrightnessPercentage(50);
    expect(analogGain()).toBeCloseTo(Math.pow(0.5, 2.2));
    expect(await driver.getBrightnessPercentage()).toBe(50);
    await driver.setBrightnessPercentage(100);
    expect(analogGain()).toBe(1);
    await driver.setBrightnessPercentage(130);
    expect(analogGain()).toBeCloseTo(1.3);
    expect(await driver.getBrightnessPercentage()).toBe(130);
    await driver.setBrightnessPercentage(200);
    expect(analogGain()).toBeCloseTo(1.6);
  });

  it('reads a gain below its range as its lowest brightness', async () => {
    const { driver } = createDriver(VALVE_INDEX, 0.001);
    await firstValueFrom(driver.isAvailable());
    expect(await driver.getBrightnessPercentage()).toBe(9);
  });

  it("reads a missing gain as SteamVR's default of 100%", async () => {
    const { driver } = createDriver(VALVE_INDEX, null);
    await firstValueFrom(driver.isAvailable());
    expect(await driver.getBrightnessPercentage()).toBe(100);
  });
});
