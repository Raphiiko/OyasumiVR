import { BehaviorSubject, filter, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import type { DMKnownDevice } from '../../../models/device-manager';
import { OVRDevice } from '../../../models/ovr-device';
import { OpenVRService } from '../../openvr.service';
import { SteamVRAnalogGainHardwareBrightnessControlDriver } from './steamvr-analog-gain-hardware-brightness-control-driver';

/** A successful command result, as the generated bindings return it. */
const ok = <T>(data: T) => ({ status: 'ok' as const, data });

const ANALOG_GAIN_HMD = {
  manufacturerName: 'Example',
  modelNumber: 'Headset',
  serialNumber: 'EXM-TEST0001',
  displaySupportsAnalogGain: true,
  displayMinAnalogGain: 0.2,
  displayMaxAnalogGain: 0.8,
};

const HMD_ID = 'OVR_HMD_EXM-TEST0001';

/** A known headset that opts in to SteamVR's analog gain, or opts out. */
const knownHmd = (id: string, enabled: boolean) =>
  ({
    id,
    deviceType: 'HMD',
    settings: { model: 'OTHER_HMD', hardwareBrightnessOnUnsupportedHmd: enabled },
  }) as DMKnownDevice;

/** `enabled` sets the opt-in of the HMD in ANALOG_GAIN_HMD; `knownDevices` replaces it. */
function createDriver(
  hmd: Partial<OVRDevice> | null,
  enabled = true,
  knownDevices: DMKnownDevice[] = [knownHmd(HMD_ID, enabled)]
) {
  let analogGain = 0.8;
  const openvr = {
    status: new BehaviorSubject('INITIALIZED'),
    devices: new BehaviorSubject(
      hmd ? [{ index: 0, class: 'HMD', isConnected: true, ...hmd }] : []
    ),
    getAnalogGain: async () => ok(analogGain),
    setAnalogGain: async (value: number) => {
      analogGain = value;
    },
  } as unknown as OpenVRService;
  const driver = new SteamVRAnalogGainHardwareBrightnessControlDriver(
    new BehaviorSubject(knownDevices),
    openvr
  );
  return { driver, analogGain: () => analogGain };
}

describe('SteamVRAnalogGainHardwareBrightnessControlDriver', () => {
  it('is available whenever enabled with an HMD connected', async () => {
    const available = (hmd: Partial<OVRDevice> | null, enabled = true) =>
      firstValueFrom(createDriver(hmd, enabled).driver.isAvailable());
    expect(await available(ANALOG_GAIN_HMD)).toBe(true);
    expect(await available({ ...ANALOG_GAIN_HMD, displaySupportsAnalogGain: false })).toBe(true);
    expect(await available(ANALOG_GAIN_HMD, false)).toBe(false);
    expect(await available({ ...ANALOG_GAIN_HMD, isConnected: false })).toBe(false);
    expect(await available(null)).toBe(false);
  });

  it.each([
    ['without its own value', []],
    ['when only another HMD opts in', [knownHmd('OVR_HMD_EXM-OTHER', true)]],
  ])('does not serve an HMD %s', async (_, knownDevices) => {
    const { driver } = createDriver(ANALOG_GAIN_HMD, true, knownDevices);
    expect(await firstValueFrom(driver.isAvailable())).toBe(false);
  });

  it.each([
    ['no range', { displayMinAnalogGain: undefined, displayMaxAnalogGain: undefined }],
    ['an empty range', { displayMaxAnalogGain: 0.2 }],
  ])('falls back to gain 0.0 to 1.0 for an HMD with %s', async (_, range) => {
    const { driver, analogGain } = createDriver({ ...ANALOG_GAIN_HMD, ...range });
    await firstValueFrom(driver.isAvailable());
    await driver.setBrightnessPercentage(20);
    expect(analogGain()).toBe(0);
    await driver.setBrightnessPercentage(100);
    expect(analogGain()).toBe(1);
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

  it('finishes a read that SteamVR stops in the middle of', async () => {
    let resolveGain: (gain: number) => void = () => {};
    const status = new BehaviorSubject('INITIALIZED');
    const openvr = {
      status,
      devices: new BehaviorSubject([
        { index: 0, class: 'HMD', isConnected: true, ...ANALOG_GAIN_HMD },
      ]),
      getAnalogGain: () =>
        new Promise((resolve) => (resolveGain = (gain: number) => resolve(ok(gain)))),
      setAnalogGain: async () => {},
    } as unknown as OpenVRService;
    const driver = new SteamVRAnalogGainHardwareBrightnessControlDriver(
      new BehaviorSubject([knownHmd(HMD_ID, true)]),
      openvr
    );
    await firstValueFrom(driver.isAvailable());

    const read = driver.getBrightnessPercentage();
    status.next('STOPPED');
    await firstValueFrom(driver.isAvailable().pipe(filter((available) => !available)));
    resolveGain(0.5);

    expect(await read).toBe(60);
  });
});
