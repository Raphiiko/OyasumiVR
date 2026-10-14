import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../../models/settings';
import { OVRDevice } from '../../../models/ovr-device';
import { OpenVRService } from '../../openvr.service';
import { AnalogGainHardwareBrightnessControlDriver } from './analog-gain-hardware-brightness-control-driver';

const ANALOG_GAIN_HMD = {
  manufacturerName: 'Example',
  modelNumber: 'Headset',
  displaySupportsAnalogGain: true,
  displayMinAnalogGain: 0.2,
  displayMaxAnalogGain: 0.8,
};

function createDriver(hmd: Partial<OVRDevice>, enabled = true) {
  let analogGain = 0.8;
  const openvr = {
    status: new BehaviorSubject('INITIALIZED'),
    devices: new BehaviorSubject([{ index: 0, class: 'HMD', ...hmd }]),
    getAnalogGain: async () => analogGain,
    setAnalogGain: async (value: number) => {
      analogGain = value;
    },
  } as unknown as OpenVRService;
  const settings = new BehaviorSubject({
    ...APP_SETTINGS_DEFAULT,
    hardwareBrightnessOnUnsupportedHmds: enabled,
  });
  const driver = new AnalogGainHardwareBrightnessControlDriver(settings, openvr);
  return { driver, analogGain: () => analogGain };
}

describe('AnalogGainHardwareBrightnessControlDriver', () => {
  it('is available only when enabled and the HMD reports a usable range', async () => {
    const available = (hmd: Partial<OVRDevice>, enabled = true) =>
      firstValueFrom(createDriver(hmd, enabled).driver.isAvailable());
    expect(await available(ANALOG_GAIN_HMD)).toBe(true);
    expect(await available(ANALOG_GAIN_HMD, false)).toBe(false);
    expect(await available({ ...ANALOG_GAIN_HMD, displaySupportsAnalogGain: false })).toBe(false);
    expect(await available({ ...ANALOG_GAIN_HMD, displayMaxAnalogGain: undefined })).toBe(false);
    expect(await available({ ...ANALOG_GAIN_HMD, displayMaxAnalogGain: 0.2 })).toBe(false);
  });

  it('maps the minimum gain to 20% and the maximum gain to 100%', async () => {
    const { driver, analogGain } = createDriver(ANALOG_GAIN_HMD);
    await firstValueFrom(driver.isAvailable());
    await driver.setBrightnessPercentage(20);
    expect(analogGain()).toBeCloseTo(0.2);
    await driver.setBrightnessPercentage(100);
    expect(analogGain()).toBeCloseTo(0.8);
    await driver.setBrightnessPercentage(60);
    expect(analogGain()).toBeCloseTo(0.5);
    expect(await driver.getBrightnessPercentage()).toBe(60);
    await driver.setBrightnessPercentage(0);
    expect(analogGain()).toBeCloseTo(0.2);
  });
});
