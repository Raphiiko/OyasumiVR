import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../models/settings';
import type { OVRDevice } from '../../models/ovr-device';
import type {
  SteamFrameCct,
  SteamFrameConnectionState,
  SteamFrameFadeEnded,
  SteamFramePairing,
} from '../../models/steam-frame';
import { CCTControlService } from './cct-control.service';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
type Dependencies = ConstructorParameters<typeof CCTControlService>;

const INDEX: Partial<OVRDevice> = {
  manufacturerName: 'Valve',
  modelNumber: 'Index',
  serialNumber: 'LHR-1',
};
const BEYOND: Partial<OVRDevice> = { manufacturerName: 'Bigscreen', modelNumber: 'Beyond' };
const QUEST: Partial<OVRDevice> = { manufacturerName: 'Oculus', modelNumber: 'Quest 3' };
const FRAME: Partial<OVRDevice> = {
  manufacturerName: 'Valve',
  modelNumber: 'Steam Frame',
  serialNumber: 'FP1',
};
const FRAME_B: Partial<OVRDevice> = { ...FRAME, serialNumber: 'FP2' };

/** Waits past the drivers' 100 ms debounce of OpenVR changes. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
/** Waits past the service's 500 ms settle before it logs and resets an unclaimed headset. */
const settleUnclaimed = () => new Promise((resolve) => setTimeout(resolve, 800));

function snapshot(kelvin: number, exact = true): SteamFrameCct {
  return { available: true, gains: [1, 1, 1], kelvin, exact, fade: null };
}

async function setup(
  hmd: Partial<OVRDevice> | null,
  { tryUnsupported = false, paired = true }: { tryUnsupported?: boolean; paired?: boolean } = {}
) {
  // a previous test's service can still finish its settle and write
  await settleUnclaimed();
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
  const devices = new BehaviorSubject(hmd ? [{ index: 0, class: 'HMD', ...hmd } as OVRDevice] : []);
  const connections = new BehaviorSubject<Record<string, SteamFrameConnectionState>>({});
  const fadeEnded = new Subject<SteamFrameFadeEnded>();
  const settings = new BehaviorSubject({
    ...structuredClone(APP_SETTINGS_DEFAULT),
    cctControlOnUnsupportedHmds: tryUnsupported,
  });
  const pairing = { id: 'p', complete: true, identity: { serial: 'FP1' } } as SteamFramePairing;
  const pairingB = { id: 'q', complete: true, identity: { serial: 'FP2' } } as SteamFramePairing;
  const service = new CCTControlService(
    { status, devices } as unknown as Dependencies[0],
    { settings } as unknown as Dependencies[1],
    {
      pairings$: new BehaviorSubject(paired ? [pairing, pairingB] : []),
      connections$: connections,
      fadeEnded$: fadeEnded,
    } as unknown as Dependencies[2]
  );
  await service.init();
  await settle();
  const calls = (command: string) =>
    vi.mocked(invoke).mock.calls.filter(([name]) => name === command);
  const writes = () =>
    calls('openvr_set_analog_color_temp').map(
      ([, args]) => (args as { temperature: number }).temperature
    );
  const frameWritesTo = (pairingId: string) =>
    calls('steam_frame_set_cct')
      .map(([, args]) => args as { pairingId: string; kelvin: number })
      .filter((args) => args.pairingId === pairingId)
      .map((args) => args.kelvin);
  const frameWrites = () =>
    calls('steam_frame_set_cct').map(([, args]) => (args as { kelvin: number }).kelvin);
  const report = (cct: SteamFrameCct | null, pairingId = 'p') =>
    connections.next({
      ...connections.value,
      [pairingId]: { pairingId, status: 'connected', cct } as SteamFrameConnectionState,
    });
  const end = (operation: string, outcome: SteamFrameFadeEnded['outcome']) =>
    fadeEnded.next({ pairingId: 'p', control: 'cct', operation, outcome });
  const reply = (cct: SteamFrameCct) => replies.shift()!(cct);
  const setTryUnsupported = (value: boolean) =>
    settings.next({ ...settings.value, cctControlOnUnsupportedHmds: value });
  const activate = (device: Partial<OVRDevice>) =>
    devices.next([{ index: 0, class: 'HMD', ...device } as OVRDevice]);
  return {
    service,
    status,
    calls,
    writes,
    frameWrites,
    frameWritesTo,
    report,
    reply,
    setTryUnsupported,
    activate,
    end,
  };
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

  it('never writes the SteamVR color gains for a Frame, also while trying any headset', async () => {
    const { service, writes } = await setup(FRAME, { tryUnsupported: true, paired: false });

    expect(await firstValueFrom(service.activeDriver)).toBe(service.driverSteamFrame);
    await service.setCCT(3000);
    await settleUnclaimed();
    expect(writes()).toEqual([]);
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
});

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
    expect(h.writes()).toEqual([]);
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
    expect(h.writes()).toEqual([]);
    // a color temperature command sends nothing that changes brightness
    const commands = vi.mocked(invoke).mock.calls.map(([name]) => name);
    expect(commands.filter((name) => name.includes('brightness'))).toEqual([]);
  });

  it('writes nothing for an allowlisted Frame without the path', async () => {
    const h = await setup(FRAME, { paired: false });
    await h.service.setCCT(3000);
    expect(h.service.cct).toBe(6600);
    expect(h.frameWrites()).toEqual([]);
    expect(h.writes()).toEqual([]);
  });

  it('writes nothing for a paired Frame before its first report', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    await h.service.setCCT(3000);
    expect(h.frameWrites()).toEqual([]);
    expect(h.writes()).toEqual([]);
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

  it('keeps the shown value when the Frame path becomes unavailable', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(2500));
    await settle();
    h.report({ available: false, gains: null, kelvin: null, exact: null });
    await settle();
    expect(h.service.cct).toBe(2500);
  });

  it('fades through the helper, and keeps the fade through reports', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    await settle();
    const task = h.service.transitionCCT(3000, 10000);
    await settle();
    const [[, args]] = h.calls('steam_frame_fade');
    const { operation, ...request } = (args as { request: { operation: string } }).request;
    expect(request).toEqual({ control: 'cct', target: 3000, durationMs: 10000 });
    h.report(snapshot(5000));
    await settle();
    expect(h.service.cct).toBe(5000);
    expect(await firstValueFrom(h.service.activeTransition)).toBe(task);
    expect(h.frameWrites()).toEqual([]);
    h.end(operation, 'externalChange');
    await settle();
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
    expect(h.frameWrites()).toEqual([]);
  });

  it('drops a waiting set when a helper fade starts, so the set cannot supersede it', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    await settle();
    await h.service.setCCT(5000);
    await h.service.setCCT(4000);
    h.service.transitionCCT(3000, 10000);
    await settle();
    expect(h.calls('steam_frame_fade')).toHaveLength(1);
    h.reply(snapshot(5000));
    await settle();
    expect(h.frameWrites()).toEqual([5000]);
  });

  it('sets the target when the helper refuses the fade', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    await settle();
    const impl = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === 'steam_frame_fade' ? Promise.reject('offline') : impl(command, args)
    );
    h.service.transitionCCT(3000, 10000);
    await settle();
    expect(h.frameWrites()).toEqual([3000]);
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('runs no helper fade to the value the Frame already holds', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(3000));
    await settle();
    h.service.transitionCCT(3000, 10000);
    await settle();
    expect(h.calls('steam_frame_fade')).toEqual([]);
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('limits a helper fade to the 24 hours the helper accepts', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    await settle();
    h.service.transitionCCT(3000, 25 * 60 * 60 * 1000);
    await settle();
    const [[, args]] = h.calls('steam_frame_fade');
    expect((args as { request: { durationMs: number } }).request.durationMs).toBe(86400000);
  });

  it('moves a helper fade target to another Frame that becomes active', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    h.report(snapshot(5000), 'q');
    await settle();
    h.service.transitionCCT(3000, 10000);
    await settle();
    h.activate(FRAME_B);
    await settle();
    expect(h.calls('steam_frame_cancel_fade')).toHaveLength(1);
    expect(h.frameWritesTo('q')).toEqual([3000]);
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('writes a helper fade target to an Index that takes over', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    await settle();
    h.service.transitionCCT(3000, 10000);
    await settle();
    h.activate(INDEX);
    await settle();
    expect(h.calls('steam_frame_cancel_fade')).toHaveLength(1);
    expect(h.writes()).toEqual([3000]);
  });

  it('writes a helper fade target to an Index that takes over while trying any headset', async () => {
    const h = await setup(FRAME, { tryUnsupported: true });
    h.report(snapshot(6600));
    await settle();
    h.service.transitionCCT(1800, 10000);
    await settle();
    h.report(snapshot(5000));
    await settle();
    h.activate(INDEX);
    await settle();
    expect(h.calls('steam_frame_cancel_fade')).toHaveLength(1);
    expect(h.writes()).not.toContain(5000);
    expect(h.writes().at(-1)).toBe(1800);
  });

  it('stops a running fade when a transition asks for the value the Frame holds', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    await settle();
    h.service.transitionCCT(1800, 10000);
    await settle();
    h.report(snapshot(5000));
    await settle();
    h.service.transitionCCT(5000, 10000);
    await settle();
    expect(h.calls('steam_frame_cancel_fade')).toHaveLength(1);
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('starts no waiting fade when the first report holds its target exactly', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    const task = h.service.transitionCCT(6600, 10000);
    await settle();
    h.report(snapshot(6600));
    await settle();
    expect(h.calls('steam_frame_fade')).toEqual([]);
    expect(task.isComplete()).toBe(true);
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('runs a fade at full length when the Frame reports before its planned end', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    h.service.transitionCCT(3000, 10000);
    await settle();
    expect(h.calls('steam_frame_fade')).toEqual([]);
    h.report(snapshot(6600));
    await settle();
    expect(h.calls('steam_frame_fade')).toEqual([
      [
        'steam_frame_fade',
        expect.objectContaining({
          request: expect.objectContaining({ target: 3000, durationMs: 10000 }),
        }),
      ],
    ]);
    expect(h.frameWrites()).toEqual([]);
  });

  it('sets the target of a fade the Frame reported too late for', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    const task = h.service.transitionCCT(3000, 20);
    await settle();
    expect(task.isComplete()).toBe(true);
    h.report(snapshot(6600));
    await settle();
    expect(h.calls('steam_frame_fade')).toEqual([]);
    expect(h.frameWrites()).toEqual([3000]);
  });

  it('keeps stepping a running transition on the Frame that takes over', async () => {
    const h = await setup(FRAME);
    h.report(null);
    h.status.next('STOPPED');
    await settle();
    // a transition that started with no HMD runs a PC loop
    const task = h.service.transitionCCT(3000, 10000, { logReason: 'SLEEP_MODE_ENABLE' });
    h.status.next('INITIALIZED');
    await settle();
    h.report(snapshot(6000));
    await settle();
    expect(await firstValueFrom(h.service.activeTransition)).toBe(task);
    expect(h.frameWrites()).toHaveLength(1);
    expect(h.frameWrites()[0]).toBeGreaterThan(3000);
    task.cancel();
  });

  it('applies a value set before the first report once the Frame reports', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    await h.service.setCCT(2800);
    expect(h.service.cct).toBe(6600);
    h.report(snapshot(6000));
    await settle();
    expect(h.frameWrites()).toEqual([2800]);
  });

  it('writes only the newest value set before the first report', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    await h.service.setCCT(2000);
    await h.service.setCCT(4500);
    h.report(snapshot(6600));
    await settle();
    expect(h.frameWrites()).toEqual([4500]);
  });

  it('drops a value that waited for the Frame longer than two minutes', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    await h.service.setCCT(2800);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 120_001);
    h.report(snapshot(6000));
    vi.mocked(Date.now).mockRestore();
    await settle();
    expect(h.frameWrites()).toEqual([]);
    expect(h.service.cct).toBe(6000);
  });

  it('drops a value set before the first report when another headset takes over', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    await h.service.setCCT(2800);
    h.activate(INDEX);
    await settle();
    expect(h.writes()).toEqual([6600]);
  });

  it('sends a set for a Frame that took over while a command to another Frame runs', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(6600));
    h.report(snapshot(5500), 'q');
    await settle();
    await h.service.setCCT(3000);
    h.activate(FRAME_B);
    await settle();
    await h.service.setCCT(3000);
    h.reply(snapshot(3000));
    await settle();
    expect(h.frameWritesTo('q')).toEqual([3000]);
  });

  it('drops a value set before the first report when another Frame takes over', async () => {
    const h = await setup(FRAME);
    h.report(null);
    await settle();
    await h.service.setCCT(2800);
    h.activate(FRAME_B);
    await settle();
    h.report(snapshot(5500), 'q');
    await settle();
    expect(h.frameWrites()).toEqual([]);
    expect(h.service.cct).toBe(5500);
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

  it('writes the app value when the Index takes over from a Frame', async () => {
    const h = await setup(FRAME);
    h.report(snapshot(3000));
    await settle();
    h.activate(INDEX);
    await settle();
    expect(h.writes()).toEqual([3000]);
  });

  it('writes the app value when the Index takes over from a Frame while trying any headset', async () => {
    const h = await setup(FRAME, { tryUnsupported: true });
    h.report(snapshot(3000));
    await settle();
    h.activate(INDEX);
    await settle();
    expect(h.writes()).toEqual([3000]);
  });

  it('keeps stepping a running Index transition on a reporting Frame that takes over', async () => {
    const h = await setup(INDEX);
    h.report(snapshot(6000));
    await settle();
    const task = h.service.transitionCCT(3000, 10000, { logReason: 'SLEEP_MODE_ENABLE' });
    await settle();
    h.activate(FRAME);
    await settle();
    expect(await firstValueFrom(h.service.activeTransition)).toBe(task);
    expect(h.frameWrites()).toHaveLength(1);
    expect(h.frameWrites()[0]).toBeGreaterThan(3000);
    task.cancel();
  });
});
