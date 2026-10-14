import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../../models/settings';
import { OVRDevice } from '../../../models/ovr-device';
import { OpenVRService } from '../../openvr.service';
import { PSVR2HardwareBrightnessControlDriver } from './psvr2-hardware-brightness-control-driver';

function createDriver(hmd: Partial<OVRDevice>) {
  let analogGain = 1;
  const openvr = {
    status: new BehaviorSubject('INITIALIZED'),
    devices: new BehaviorSubject([{ class: 'HMD', ...hmd }]),
    getAnalogGain: async () => analogGain,
    setAnalogGain: async (value: number) => {
      analogGain = value;
    },
  } as unknown as OpenVRService;
  const driver = new PSVR2HardwareBrightnessControlDriver(of(APP_SETTINGS_DEFAULT), openvr);
  return { driver, analogGain: () => analogGain };
}

const PSVR2_WITH_TOOLKIT = {
  manufacturerName: 'SIE',
  modelNumber: 'PS VR2',
  displaySupportsAnalogGain: true,
};

describe('PSVR2HardwareBrightnessControlDriver', () => {
  it('is available only when the PS VR2 advertises analog gain', async () => {
    expect(await firstValueFrom(createDriver(PSVR2_WITH_TOOLKIT).driver.isAvailable())).toBe(true);
    for (const hmd of [
      { ...PSVR2_WITH_TOOLKIT, displaySupportsAnalogGain: false },
      { ...PSVR2_WITH_TOOLKIT, displaySupportsAnalogGain: undefined },
      { ...PSVR2_WITH_TOOLKIT, modelNumber: 'Index', manufacturerName: 'Valve' },
    ]) {
      expect(await firstValueFrom(createDriver(hmd).driver.isAvailable())).toBe(false);
    }
  });

  it('maps 10% to 100% onto the full gain range and reads the same percentage back', async () => {
    const { driver, analogGain } = createDriver(PSVR2_WITH_TOOLKIT);
    await driver.setBrightnessPercentage(10);
    expect(analogGain()).toBe(0);
    await driver.setBrightnessPercentage(100);
    expect(analogGain()).toBe(1);
    await driver.setBrightnessPercentage(55);
    expect(analogGain()).toBeCloseTo(Math.pow(0.5, 2.2));
    expect(await driver.getBrightnessPercentage()).toBe(55);
  });

  it('leaves brightness below 10% to software brightness', async () => {
    const { driver, analogGain } = createDriver(PSVR2_WITH_TOOLKIT);
    expect(driver.getBrightnessBounds()).toEqual([10, 100]);
    await driver.setBrightnessPercentage(0);
    expect(analogGain()).toBe(0);
  });
});
