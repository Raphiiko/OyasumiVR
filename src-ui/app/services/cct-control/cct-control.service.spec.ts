import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../models/settings';
import type { OVRDevice } from '../../models/ovr-device';
import { CCTControlService } from './cct-control.service';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
type Dependencies = ConstructorParameters<typeof CCTControlService>;

const INDEX: Partial<OVRDevice> = { manufacturerName: 'Valve', modelNumber: 'Index' };
const BEYOND: Partial<OVRDevice> = { manufacturerName: 'Bigscreen', modelNumber: 'Beyond' };
const QUEST: Partial<OVRDevice> = { manufacturerName: 'Oculus', modelNumber: 'Quest 3' };

/** Waits past the driver's 100 ms debounce of OpenVR changes. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
/** Waits past the service's 500 ms settle before it logs and resets an unclaimed headset. */
const settleUnclaimed = () => new Promise((resolve) => setTimeout(resolve, 800));

async function setup(hmd: Partial<OVRDevice> | null, tryUnsupported = false) {
  // a previous test's service can still finish its settle and write
  await settleUnclaimed();
  vi.mocked(invoke).mockClear();
  const status = new BehaviorSubject('INITIALIZED');
  const devices = new BehaviorSubject(hmd ? [{ index: 0, class: 'HMD', ...hmd } as OVRDevice] : []);
  const settings = new BehaviorSubject({
    ...structuredClone(APP_SETTINGS_DEFAULT),
    cctControlOnUnsupportedHmds: tryUnsupported,
  });
  const service = new CCTControlService(
    { status, devices } as unknown as Dependencies[0],
    { settings } as unknown as Dependencies[1]
  );
  await service.init();
  await settle();
  const writes = () =>
    vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === 'openvr_set_analog_color_temp')
      .map(([, args]) => (args as { temperature: number }).temperature);
  const setTryUnsupported = (value: boolean) =>
    settings.next({ ...settings.value, cctControlOnUnsupportedHmds: value });
  const activate = (device: Partial<OVRDevice>) =>
    devices.next([{ index: 0, class: 'HMD', ...device } as OVRDevice]);
  return { service, writes, setTryUnsupported, activate };
}

describe('CCTControlService driver selection', () => {
  it.each([
    ['an Index', INDEX],
    ['a Beyond', BEYOND],
  ])('writes the SteamVR color gains on %s', async (_, hmd) => {
    const { service, writes } = await setup(hmd);

    expect(await firstValueFrom(service.driverIsAvailable)).toBe(true);
    expect(writes()).toEqual([6600]);
    await service.setCCT(3000);
    expect(writes()).toEqual([6600, 3000]);
  });

  it('only resets a headset that is not on the list to neutral', async () => {
    const { service, writes } = await setup(QUEST);

    expect(await firstValueFrom(service.driverIsAvailable)).toBe(false);
    expect(await firstValueFrom(service.activeDriver)).toBeNull();
    await settleUnclaimed();
    expect(writes()).toEqual([6600]);
    await service.setCCT(3000);
    await settleUnclaimed();
    expect(service.cct).toBe(3000);
    expect(writes()).toEqual([6600]);
  });

  it('writes nothing while no headset is connected', async () => {
    const { service, writes } = await setup(null);

    await service.setCCT(3000);
    await settleUnclaimed();
    expect(writes()).toEqual([]);
  });

  it('tries an unlisted headset while the setting is on', async () => {
    const { service, writes, setTryUnsupported } = await setup(QUEST);

    setTryUnsupported(true);
    await settle();
    expect(await firstValueFrom(service.driverIsAvailable)).toBe(true);
    expect(writes()).toEqual([6600]);

    await service.setCCT(3000);
    expect(writes()).toEqual([6600, 3000]);

    setTryUnsupported(false);
    await settleUnclaimed();
    expect(writes()).toEqual([6600, 3000, 6600]);
    await service.setCCT(4000);
    expect(writes()).toEqual([6600, 3000, 6600]);
  });

  it('writes the stored value once a listed headset becomes active', async () => {
    const { service, writes, activate } = await setup(null);

    await service.setCCT(4000);
    expect(writes()).toEqual([]);
    activate(INDEX);
    await settle();
    expect(writes()).toEqual([4000]);
  });
});

describe('CCTControlService transitions', () => {
  it('steps a SteamVR driver transition on the PC', async () => {
    const { service, writes } = await setup(INDEX);

    const task = service.transitionCCT(3000, 100);
    expect(await firstValueFrom(service.activeTransition)).toBe(task);
    await settle();
    expect(writes().length).toBeGreaterThan(3);
    expect(writes().at(-1)).toBe(3000);
    expect(await firstValueFrom(service.activeTransition)).toBeUndefined();
  });

  it('sets the target in one command for a driver that skips transitions', async () => {
    const { service, writes } = await setup(INDEX);
    Object.defineProperty(service.driverSteamVr, 'skipsTransitions', { value: true });

    service.transitionCCT(3000, 1000);
    await Promise.resolve();
    expect(await firstValueFrom(service.activeTransition)).toBeUndefined();
    expect(writes()).toEqual([6600, 3000]);
  });
});
