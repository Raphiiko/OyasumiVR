import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import { APP_SETTINGS_DEFAULT } from '../../models/settings';
import type { OVRDevice } from '../../models/ovr-device';
import type {
  SteamFrameConnectionState,
  SteamFrameFadeEnded,
  SteamFramePairing,
} from '../../models/steam-frame';
import { HardwareBrightnessControlService } from './hardware-brightness-control.service';
import { SimpleBrightnessControlService } from './simple-brightness-control.service';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => false) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
type Dependencies = ConstructorParameters<typeof HardwareBrightnessControlService>;
type SimpleDependencies = ConstructorParameters<typeof SimpleBrightnessControlService>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A service whose only available driver is a paired Frame reporting within 20%–110%. */
async function setup(
  initial: number | null = 40,
  commands: (command: string) => Promise<unknown> = async () => false
) {
  vi.mocked(invoke).mockImplementation(commands);
  const connections = new BehaviorSubject<Record<string, SteamFrameConnectionState>>({});
  const fadeEnded = new Subject<SteamFrameFadeEnded>();
  const devices = new BehaviorSubject([{ class: 'HMD', serialNumber: 'FP1' } as OVRDevice]);
  const service = new HardwareBrightnessControlService(
    {
      status: new BehaviorSubject('INITIALIZED'),
      devices,
    } as unknown as Dependencies[0],
    {
      settings: new BehaviorSubject(structuredClone(APP_SETTINGS_DEFAULT)),
    } as unknown as Dependencies[1],
    {
      pairings$: new BehaviorSubject([
        { id: 'p', complete: true, identity: { serial: 'FP1' } } as SteamFramePairing,
      ]),
      connections$: connections,
      fadeEnded$: fadeEnded,
    } as unknown as Dependencies[2]
  );
  await service.init();
  const report = (
    percentage: number,
    { status = 'connected', fade }: { status?: string; fade?: string } = {}
  ) =>
    connections.next({
      p: {
        pairingId: 'p',
        status,
        brightness: {
          runtime: true,
          supported: true,
          min: 20,
          max: 110,
          percentage,
          fade: fade ? { operation: fade, target: 0, remainingMs: 1, endsAt: 0 } : null,
        },
      } as SteamFrameConnectionState,
    });
  const writes = () =>
    vi.mocked(invoke).mock.calls.filter(([command]) => command === 'steam_frame_set_brightness');
  vi.mocked(invoke).mockClear();
  if (initial !== null) report(initial);
  await settle();
  const fades = () =>
    vi.mocked(invoke).mock.calls.filter(([command]) => command === 'steam_frame_fade');
  const end = (operation: string, outcome: SteamFrameFadeEnded['outcome']) =>
    fadeEnded.next({ pairingId: 'p', control: 'brightness', operation, outcome });
  return { service, devices, report, writes, fades, end };
}

describe('HardwareBrightnessControlService with a Steam Frame', () => {
  it('shows reports and their bounds without writing them', async () => {
    const h = await setup();
    const adopted: number[] = [];
    h.service.adoptedBrightness.subscribe((value) => adopted.push(value.percentage));
    expect(await firstValueFrom(h.service.driverIsAvailable)).toBe(true);
    expect(h.service.brightness).toBe(40);
    expect(await firstValueFrom(h.service.brightnessBounds)).toEqual([20, 110]);
    h.report(150);
    await settle();
    expect(h.service.brightness).toBe(110);
    // the report from before the subscription replays first
    expect(adopted).toEqual([40, 110]);
    expect(h.writes()).toEqual([]);
  });

  it('runs a transition as one helper fade, through a reconnect', async () => {
    const h = await setup();
    vi.mocked(invoke).mockImplementation(async () => undefined);
    const task = h.service.transitionBrightness(80, 10000);
    await settle();
    const [[, args]] = h.fades();
    const { operation, ...request } = (args as { request: { operation: string } }).request;
    expect(request).toEqual({ control: 'brightness', target: 80, durationMs: 10000 });
    expect(h.writes()).toEqual([]);
    expect(await firstValueFrom(h.service.activeTransition)).toBe(task);

    // the connection drops and returns; the fade goes on
    h.report(50, { status: 'offline' });
    await settle();
    h.report(55, { fade: operation });
    await settle();
    expect(await firstValueFrom(h.service.activeTransition)).toBe(task);
    expect(h.writes()).toEqual([]);
    expect(h.service.brightness).toBe(55);

    h.end(operation, 'completed');
    await settle();
    expect(task.isComplete()).toBe(true);
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('sets the target when the helper refuses the fade', async () => {
    const h = await setup();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'steam_frame_fade') throw 'offline';
      return command === 'steam_frame_set_brightness'
        ? (args as { percentage: number }).percentage
        : undefined;
    });
    h.service.transitionBrightness(80, 10000);
    await settle();
    await settle();
    expect(h.writes()).toHaveLength(1);
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('drops a waiting set when a helper fade starts, so the set cannot supersede it', async () => {
    const h = await setup();
    const replies: ((value: number) => void)[] = [];
    vi.mocked(invoke).mockImplementation((command) =>
      command === 'steam_frame_set_brightness'
        ? new Promise((resolve) => replies.push(resolve))
        : Promise.resolve(undefined)
    );
    void h.service.setBrightness(60);
    void h.service.setBrightness(70);
    await settle();
    h.service.transitionBrightness(80, 10000);
    await settle();
    expect(h.fades()).toHaveLength(1);
    replies.shift()!(60);
    await settle();
    expect(h.writes()).toHaveLength(1);
  });

  it('cancels a helper fade and sets its target once another headset takes over', async () => {
    const h = await setup();
    vi.mocked(invoke).mockImplementation(async () => undefined);
    h.service.transitionBrightness(80, 10000);
    await settle();
    const setBrightness = vi.spyOn(h.service, 'setBrightness').mockResolvedValue();
    h.devices.next([{ class: 'HMD', serialNumber: 'LHR-1' } as OVRDevice]);
    await settle();
    const cancels = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === 'steam_frame_cancel_fade');
    expect(cancels).toHaveLength(1);
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
    expect(setBrightness).not.toHaveBeenCalled();

    // the new headset's driver becomes available later
    const nextDriver = {
      isAvailable: () => new BehaviorSubject(false),
      getBrightnessBounds: () => [0, 100],
      getBrightnessPercentage: async () => 80,
    };
    h.service['driver'].next(nextDriver as unknown as typeof h.service.driverValveIndex);
    await settle();
    expect(setBrightness).toHaveBeenCalledWith(80);
  });

  it('writes a handoff target the next headset only appears to hold', async () => {
    const h = await setup();
    vi.mocked(invoke).mockImplementation(async () => undefined);
    h.service.transitionBrightness(20, 10000);
    await settle();
    // the Frame reached the target, which is also the next headset's floor
    h.report(20, { fade: 'running' });
    await settle();
    expect(h.service.brightness).toBe(20);
    h.devices.next([{ class: 'HMD', serialNumber: 'LHR-1' } as OVRDevice]);
    await settle();

    const nextDriver = {
      isAvailable: () => new BehaviorSubject(true),
      getBrightnessBounds: () => [20, 160],
      getBrightnessPercentage: async () => 100,
      setBrightnessPercentage: vi.fn(async () => {}),
    };
    h.service['driver'].next(nextDriver as unknown as typeof h.service.driverValveIndex);
    await settle();
    expect(nextDriver.setBrightnessPercentage).toHaveBeenCalledWith(20);
  });

  it('drops a helper fade the headset changed, and shows the change', async () => {
    const h = await setup();
    vi.mocked(invoke).mockImplementation(async () => undefined);
    const task = h.service.transitionBrightness(80, 10000);
    await settle();
    const operation = (h.fades()[0][1] as { request: { operation: string } }).request.operation;
    h.report(30);
    h.end(operation, 'externalChange');
    await settle();
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
    expect(task.isCancelled() || task.isComplete()).toBe(true);
    expect(h.service.brightness).toBe(30);
    expect(h.writes()).toEqual([]);
  });

  it('keeps a pending request on screen past the availability delay', async () => {
    const h = await setup();
    vi.mocked(invoke).mockImplementation((command) =>
      command === 'steam_frame_set_brightness' ? new Promise(() => {}) : Promise.resolve(false)
    );
    void h.service.setBrightness(80);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(h.service.brightness).toBe(80);
  });

  it('picks the paired Frame before its first report, over a connected Beyond', async () => {
    const h = await setup(null, async (command) => command === 'bigscreen_beyond_is_connected');
    await settle();
    expect(h.service.activeDriver).toBe(h.service.driverSteamFrame);
    expect(await firstValueFrom(h.service.driverIsAvailable)).toBe(false);
  });

  it('sends a value set before the first report once the Frame reports', async () => {
    const h = await setup(null);
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === 'steam_frame_set_brightness' ? (args as { percentage: number }).percentage : false
    );
    await h.service.setBrightness(80);
    expect(h.writes()).toEqual([]);
    h.report(40);
    await settle();
    expect(h.writes()).toEqual([
      ['steam_frame_set_brightness', { pairingId: 'p', percentage: 80 }],
    ]);
    expect(h.service.brightness).toBe(80);
  });

  it('runs a fade at full length when the Frame reports before its planned end', async () => {
    const h = await setup(null);
    h.service.transitionBrightness(80, 10_000);
    await settle();
    const fades = () => vi.mocked(invoke).mock.calls.filter(([c]) => c === 'steam_frame_fade');
    expect(fades()).toEqual([]);
    h.report(40);
    await settle();
    expect(fades()).toEqual([
      [
        'steam_frame_fade',
        expect.objectContaining({
          request: expect.objectContaining({ target: 80, durationMs: 10_000 }),
        }),
      ],
    ]);
  });

  it('sets the target of a fade the Frame reported too late for', async () => {
    const h = await setup(null);
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === 'steam_frame_set_brightness' ? (args as { percentage: number }).percentage : false
    );
    const task = h.service.transitionBrightness(80, 20);
    await firstValueFrom(task.onComplete);
    h.report(40);
    await settle();
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'steam_frame_fade')).toEqual([]);
    expect(h.writes()).toEqual([
      ['steam_frame_set_brightness', { pairingId: 'p', percentage: 80 }],
    ]);
    expect(h.service.brightness).toBe(80);
  });

  it('drops a value that waited for the Frame longer than two minutes', async () => {
    const h = await setup(null);
    await h.service.setBrightness(80);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 120_001);
    h.report(40);
    vi.mocked(Date.now).mockRestore();
    await settle();
    expect(h.writes()).toEqual([]);
    expect(h.service.brightness).toBe(40);
  });

  it('writes a bound the cache shows only because it clamped the report', async () => {
    const h = await setup(40);
    h.report(150);
    await settle();
    expect(h.service.brightness).toBe(110);
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === 'steam_frame_set_brightness' ? (args as { percentage: number }).percentage : false
    );
    await h.service.setBrightness(110);
    expect(h.writes()).toEqual([
      ['steam_frame_set_brightness', { pairingId: 'p', percentage: 110 }],
    ]);
  });
});

describe('simple brightness following a Steam Frame', () => {
  async function simple(hardware: HardwareBrightnessControlService, softwareBrightness: number) {
    const software = {
      brightness: softwareBrightness,
      setBrightness: vi.fn(async (percentage: number) => {
        software.brightness = percentage;
      }),
      cancelActiveTransition: vi.fn(),
    };
    const service = new SimpleBrightnessControlService(
      { configs: new BehaviorSubject(structuredClone(AUTOMATION_CONFIGS_DEFAULT)) } as never,
      hardware,
      software as unknown as SimpleDependencies[2]
    );
    await service.init();
    return { service, software };
  }

  it('derives the first report with the Frame bounds and keeps software dimming', async () => {
    const h = await setup(null);
    const s = await simple(h.service, 50);
    h.report(20);
    await settle();
    expect(s.service.brightness).toBe(10);
    expect(s.software.setBrightness).not.toHaveBeenCalled();
    expect(h.writes()).toEqual([]);
  });

  it('gives a paired Frame its part of a value set before the first report', async () => {
    const h = await setup(null);
    const s = await simple(h.service, 100);
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === 'steam_frame_set_brightness' ? (args as { percentage: number }).percentage : false
    );
    await s.service.setBrightness(60);
    expect(s.software.brightness).toBe(100);
    expect(h.writes()).toEqual([]);
    h.report(40);
    await settle();
    expect(h.writes()).toHaveLength(1);
    expect(s.software.brightness).toBe(100);
  });

  it('derives a report that arrived before simple mode started', async () => {
    const h = await setup(40);
    const s = await simple(h.service, 100);
    await settle();
    expect(s.service.brightness).toBeCloseTo(20 + (20 / 90) * 80);
    expect(h.writes()).toEqual([]);
  });

  it('shows the value the headset kept after a failed write', async () => {
    const h = await setup(40);
    const s = await simple(h.service, 100);
    vi.mocked(invoke).mockImplementation((command) =>
      command === 'steam_frame_set_brightness'
        ? Promise.reject('writeFailed')
        : Promise.resolve(false)
    );
    await s.service.setBrightness(80);
    await settle();
    expect(h.service.brightness).toBe(40);
    expect(s.service.brightness).toBeCloseTo(20 + (20 / 90) * 80);
  });
});
