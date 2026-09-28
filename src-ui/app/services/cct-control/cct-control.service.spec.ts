import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../models/settings';
import type { OVRDevice } from '../../models/ovr-device';
import type {
  SteamFrameCct,
  SteamFrameConnectionState,
  SteamFramePairing,
} from '../../models/steam-frame';
import { CCTControlService } from './cct-control.service';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
type Dependencies = ConstructorParameters<typeof CCTControlService>;

const FRAME: Partial<OVRDevice> = {
  manufacturerName: 'Valve',
  modelNumber: 'Steam Frame',
  serialNumber: 'FP1',
};
const FRAME_B: Partial<OVRDevice> = { ...FRAME, serialNumber: 'FP2' };
const INDEX: Partial<OVRDevice> = {
  manufacturerName: 'Valve',
  modelNumber: 'Index',
  serialNumber: 'LHR-1',
};

/** Waits past the service's 100 ms debounce of OpenVR changes. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

function snapshot(kelvin: number, exact = true): SteamFrameCct {
  return { available: true, gains: [1, 1, 1], kelvin, exact };
}

async function setup(
  hmd: Partial<OVRDevice>,
  { paired = true, enabled = true }: { paired?: boolean; enabled?: boolean } = {}
) {
  const replies: ((cct: SteamFrameCct) => void)[] = [];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'steam_frame_get_supported_models') {
      return [{ manufacturer: 'Valve', model: 'Steam Frame' }];
    }
    if (command === 'steam_frame_set_cct') {
      return new Promise((resolve) => replies.push(resolve));
    }
    return undefined;
  });
  const status = new BehaviorSubject('INITIALIZED');
  const devices = new BehaviorSubject([{ index: 0, class: 'HMD', ...hmd } as OVRDevice]);
  const connections = new BehaviorSubject<Record<string, SteamFrameConnectionState>>({});
  const settings = new BehaviorSubject({
    ...structuredClone(APP_SETTINGS_DEFAULT),
    cctControlEnabled: enabled,
  });
  const pairing = { id: 'p', complete: true, identity: { serial: 'FP1' } } as SteamFramePairing;
  const pairingB = { id: 'q', complete: true, identity: { serial: 'FP2' } } as SteamFramePairing;
  const service = new CCTControlService(
    { status, devices } as unknown as Dependencies[0],
    { settings } as unknown as Dependencies[1],
    {
      pairings$: new BehaviorSubject(paired ? [pairing, pairingB] : []),
      connections$: connections,
    } as unknown as Dependencies[2]
  );
  await service.init();
  await settle();
  const report = (cct: SteamFrameCct | null, pairingId = 'p') =>
    connections.next({
      ...connections.value,
      [pairingId]: { pairingId, status: 'connected', cct } as SteamFrameConnectionState,
    });
  const activate = (device: Partial<OVRDevice>) =>
    devices.next([{ index: 0, class: 'HMD', ...device } as OVRDevice]);
  const calls = (command: string) =>
    vi.mocked(invoke).mock.calls.filter(([name]) => name === command);
  const frameWrites = () =>
    calls('steam_frame_set_cct').map(([, args]) => (args as { kelvin: number }).kelvin);
  const reply = (cct: SteamFrameCct) => replies.shift()!(cct);
  const frameWritesTo = (pairingId: string) =>
    calls('steam_frame_set_cct')
      .map(([, args]) => args as { pairingId: string; kelvin: number })
      .filter((args) => args.pairingId === pairingId)
      .map((args) => args.kelvin);
  return { service, status, report, activate, calls, frameWrites, frameWritesTo, reply, settings };
}

describe('CCTControlService with a Steam Frame', () => {
  it('adopts reports without writing when the Frame path becomes available', async () => {
    const h = await setup(FRAME);
    expect(h.service.cct).toBe(6600);
    h.report(snapshot(3000));
    await settle();
    expect(h.service.cct).toBe(3000);
    h.report(snapshot(4500, false));
    await settle();
    expect(h.service.cct).toBe(4500);
    expect(h.frameWrites()).toEqual([]);
    expect(h.calls('openvr_set_analog_color_temp')).toEqual([]);
  });

  it('writes a paired active Frame through the helper', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    await settle();
    await h.service.setCCT(3000);
    expect(h.frameWrites()).toEqual([3000]);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('steam_frame_set_cct', {
      pairingId: 'p',
      kelvin: 3000,
    });
    expect(h.calls('openvr_set_analog_color_temp')).toEqual([]);
    // a color temperature command sends nothing that changes brightness
    const commands = vi.mocked(invoke).mock.calls.map(([name]) => name);
    expect(commands.filter((name) => name.includes('brightness'))).toEqual([]);
  });

  it('writes nothing for an allowlisted Frame without the path', async () => {
    const h = await setup(FRAME, { paired: false });
    await h.service.setCCT(3000);
    expect(h.service.cct).toBe(6600);
    expect(h.frameWrites()).toEqual([]);
    expect(h.calls('openvr_set_analog_color_temp')).toEqual([]);
  });

  it('writes nothing for a paired Frame before its first report', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    await h.service.setCCT(3000);
    expect(h.frameWrites()).toEqual([]);
    expect(h.calls('openvr_set_analog_color_temp')).toEqual([]);
  });

  it('keeps one command in flight and replaces the waiting one', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    await settle();
    await h.service.setCCT(5000);
    await h.service.setCCT(4000);
    await h.service.setCCT(3000);
    expect(h.frameWrites()).toEqual([5000]);
    // the requested value stays on screen while a command runs, also over a report
    h.report(snapshot(6000));
    await settle();
    expect(h.service.cct).toBe(3000);
    h.reply(snapshot(5000));
    await settle();
    expect(h.frameWrites()).toEqual([5000, 3000]);
    h.reply(snapshot(3001));
    await settle();
    expect(h.service.cct).toBe(3001);
  });

  it('writes the shown value over off-curve gains, and skips it once exact', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(3795, false));
    await settle();
    await h.service.setCCT(3795);
    expect(h.frameWrites()).toEqual([3795]);
    h.reply(snapshot(3795));
    await settle();
    await h.service.setCCT(3795);
    expect(h.frameWrites()).toEqual([3795]);
  });

  it('adopts reports without writing while CCT control is disabled', async () => {
    const h = await setup(FRAME, { enabled: false });
    h.report(snapshot(2500));
    await settle();
    expect(h.service.cct).toBe(2500);
    await h.service.setCCT(4000);
    expect(h.frameWrites()).toEqual([]);
  });

  it('keeps the shown value when the Frame path becomes unavailable', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(2500));
    await settle();
    h.report({ available: false, gains: null, kelvin: null, exact: null });
    await settle();
    expect(h.service.cct).toBe(2500);
  });

  it('sets a transition target in one command', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    await settle();
    const task = h.service.transitionCCT(3000, 10000);
    await settle();
    expect(task.isComplete()).toBe(true);
    expect(h.frameWrites()).toEqual([3000]);
  });

  it('finishes a running transition in one command when the Frame takes over', async () => {
    const h = await setup(FRAME, { paired: true });
    h.report(null);
    h.status.next('STOPPED');
    await settle();
    // a transition that started with no HMD runs a PC loop
    h.service.transitionCCT(3000, 10000);
    h.status.next('INITIALIZED');
    await settle();
    h.report(snapshot(6000));
    await settle();
    expect(h.frameWrites()).toEqual([3000]);
    const activeTransition = await new Promise((resolve) =>
      h.service.activeTransition.subscribe(resolve).unsubscribe()
    );
    expect(activeTransition).toBeUndefined();
  });

  it('adopts the report when a transition runs at takeover with CCT control disabled', async () => {
    const h = await setup(FRAME, { enabled: false });
    h.report(null);
    h.status.next('STOPPED');
    await settle();
    h.service.transitionCCT(3000, 10000);
    h.status.next('INITIALIZED');
    await settle();
    h.report(snapshot(4000));
    await settle();
    expect(h.service.cct).toBe(4000);
    expect(h.frameWrites()).toEqual([]);
  });

  it('drops a value queued for a Frame that stopped being active', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    h.report(snapshot(5500), 'q');
    await settle();
    await h.service.setCCT(5000);
    await h.service.setCCT(3000);
    expect(h.frameWritesTo('p')).toEqual([5000]);
    h.activate(FRAME_B);
    await settle();
    h.reply(snapshot(5000));
    await settle();
    expect(h.frameWritesTo('q')).toEqual([]);
    expect(h.service.cct).toBe(5500);
  });

  it('resolves whenFrameReports false when another Frame reports first', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    const reported = h.service.whenFrameReports();
    h.report(snapshot(3000), 'q');
    h.activate(FRAME_B);
    await settle();
    await expect(reported).resolves.toBe(false);
  });

  it('resolves whenFrameReports on the first report of the waiting Frame', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    const reported = h.service.whenFrameReports();
    expect(reported).not.toBeNull();
    h.report(snapshot(3000));
    await settle();
    await expect(reported).resolves.toBe(true);
    expect(h.service.whenFrameReports()).toBeNull();
  });

  it('resolves whenFrameReports false when the Frame leaves first', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    const reported = h.service.whenFrameReports();
    h.status.next('STOPPED');
    await settle();
    await expect(reported).resolves.toBe(false);
  });
});

describe('CCTControlService with an Index', () => {
  it('writes the app value when the Index takes over from a Frame', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(3000));
    await settle();
    h.activate(INDEX);
    await settle();
    expect(h.calls('openvr_set_analog_color_temp')).toEqual([
      ['openvr_set_analog_color_temp', { temperature: 3000 }],
    ]);
  });

  it('writes the app value when the HMD becomes ready, and each change', async () => {
    const h = await setup(INDEX);
    expect(h.calls('openvr_set_analog_color_temp')).toEqual([
      ['openvr_set_analog_color_temp', { temperature: 6600 }],
    ]);
    await h.service.setCCT(3000);
    expect(h.calls('openvr_set_analog_color_temp').at(-1)).toEqual([
      'openvr_set_analog_color_temp',
      { temperature: 3000 },
    ]);
    expect(h.service.whenFrameReports()).toBeNull();
    expect(h.frameWrites()).toEqual([]);
  });
});
