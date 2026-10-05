import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import { APP_SETTINGS_DEFAULT } from '../../models/settings';
import type { OVRDevice } from '../../models/ovr-device';
import type { SteamFrameConnectionState, SteamFramePairing } from '../../models/steam-frame';
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
  const service = new HardwareBrightnessControlService(
    {
      status: new BehaviorSubject('INITIALIZED'),
      devices: new BehaviorSubject([{ class: 'HMD', serialNumber: 'FP1' } as OVRDevice]),
    } as unknown as Dependencies[0],
    {
      settings: new BehaviorSubject(structuredClone(APP_SETTINGS_DEFAULT)),
    } as unknown as Dependencies[1],
    {
      pairings$: new BehaviorSubject([
        { id: 'p', complete: true, identity: { serial: 'FP1' } } as SteamFramePairing,
      ]),
      connections$: connections,
    } as unknown as Dependencies[2]
  );
  await service.init();
  const report = (percentage: number) =>
    connections.next({
      p: {
        pairingId: 'p',
        status: 'connected',
        brightness: { runtime: true, supported: true, min: 20, max: 110, percentage },
      } as SteamFrameConnectionState,
    });
  const writes = () =>
    vi.mocked(invoke).mock.calls.filter(([command]) => command === 'steam_frame_set_brightness');
  vi.mocked(invoke).mockClear();
  if (initial !== null) report(initial);
  await settle();
  return { service, report, writes };
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

  it('fades a transition through the PC loop', async () => {
    const h = await setup();
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === 'steam_frame_set_brightness' ? (args as { percentage: number }).percentage : false
    );
    const task = h.service.transitionBrightness(80, 200);
    await firstValueFrom(task.onComplete);
    const targets = h.writes().map(([, args]) => (args as { percentage: number }).percentage);
    expect(targets.length).toBeGreaterThan(2);
    expect(targets).toEqual([...targets].sort((a, b) => a - b));
    expect(targets.at(-1)).toBe(80);
    expect(h.service.brightness).toBe(80);
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

  it('writes a transition target that equals the clamped cache', async () => {
    const h = await setup(40);
    h.report(150);
    await settle();
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === 'steam_frame_set_brightness' ? (args as { percentage: number }).percentage : false
    );
    const task = h.service.transitionBrightness(110, 10000);
    await settle();
    expect(task.isComplete()).toBe(true);
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
