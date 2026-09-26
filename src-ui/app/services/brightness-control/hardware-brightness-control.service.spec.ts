import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../models/settings';
import type { OVRDevice } from '../../models/ovr-device';
import type { SteamFrameConnectionState, SteamFramePairing } from '../../models/steam-frame';
import { HardwareBrightnessControlService } from './hardware-brightness-control.service';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => false) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
type Dependencies = ConstructorParameters<typeof HardwareBrightnessControlService>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A service whose only available driver is a paired Frame reporting 40% within 20%–110%. */
async function setup() {
  const connections = new BehaviorSubject<Record<string, SteamFrameConnectionState>>({});
  const service = new HardwareBrightnessControlService(
    {
      status: new BehaviorSubject('INITIALIZED'),
      devices: new BehaviorSubject([{ class: 'HMD', serialNumber: 'FP1' } as OVRDevice]),
    } as unknown as Dependencies[0],
    { settings: new BehaviorSubject(structuredClone(APP_SETTINGS_DEFAULT)) } as Dependencies[1],
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
  report(40);
  await settle();
  return { service, report, writes };
}

describe('HardwareBrightnessControlService with a Steam Frame', () => {
  it('shows reports and their bounds without writing them', async () => {
    const h = await setup();
    const adopted: number[] = [];
    h.service.adoptedBrightness.subscribe((value) => adopted.push(value));
    expect(await firstValueFrom(h.service.driverIsAvailable)).toBe(true);
    expect(h.service.brightness).toBe(40);
    expect(await firstValueFrom(h.service.brightnessBounds)).toEqual([20, 110]);
    h.report(150);
    await settle();
    expect(h.service.brightness).toBe(110);
    expect(adopted).toEqual([110]);
    expect(h.writes()).toEqual([]);
  });

  it('sets a transition target in one command', async () => {
    const h = await setup();
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === 'steam_frame_set_brightness' ? (args as { percentage: number }).percentage : false
    );
    const task = h.service.transitionBrightness(80, 10000);
    await settle();
    expect(task.isComplete()).toBe(true);
    expect(h.writes()).toEqual([
      ['steam_frame_set_brightness', { pairingId: 'p', percentage: 80 }],
    ]);
    expect(h.service.brightness).toBe(80);
  });
});
