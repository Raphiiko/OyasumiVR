import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../../../models/settings';
import type { OVRDevice } from '../../../models/ovr-device';
import type {
  SteamFrameBrightness,
  SteamFrameConnectionState,
  SteamFrameFadeEnded,
  SteamFramePairing,
} from '../../../models/steam-frame';
import type { OpenVRStatus } from '../../openvr.service';
import { SteamFrameHardwareBrightnessControlDriver } from './steam-frame-hardware-brightness-control-driver';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-log', () => ({ warn: vi.fn() }));

const SERIAL = 'FPTEST000001';

function brightness(percentage: number, overrides: Partial<SteamFrameBrightness> = {}) {
  return { runtime: true, supported: true, min: 9, max: 125, percentage, ...overrides };
}

function setup() {
  const status = new BehaviorSubject<OpenVRStatus>('INITIALIZED');
  const devices = new BehaviorSubject<OVRDevice[]>([
    { class: 'HMD', serialNumber: SERIAL } as OVRDevice,
  ]);
  const pairings = new BehaviorSubject<SteamFramePairing[]>([
    { id: 'pairing-1', complete: true, identity: { serial: SERIAL } } as SteamFramePairing,
  ]);
  const connections = new BehaviorSubject<Record<string, SteamFrameConnectionState>>({});
  const driver = new SteamFrameHardwareBrightnessControlDriver(
    new BehaviorSubject(structuredClone(APP_SETTINGS_DEFAULT)),
    { status, devices },
    pairings,
    connections,
    new Subject<SteamFrameFadeEnded>()
  );
  const updates: number[] = [];
  driver.brightnessUpdates.subscribe((value) => updates.push(value));
  const report = (value: SteamFrameBrightness | null, status = 'connected', fades = false) =>
    connections.next({
      'pairing-1': {
        pairingId: 'pairing-1',
        status,
        brightness: value,
        fades,
      } as SteamFrameConnectionState,
    });
  const available = () => firstValueFrom(driver.isAvailable());
  return { status, devices, pairings, connections, driver, updates, report, available };
}

describe('SteamFrameHardwareBrightnessControlDriver', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('is available only for a connected, supported, paired Frame that is the active HMD', async () => {
    const h = setup();
    expect(await h.available()).toBe(false);
    h.report(brightness(40));
    expect(await h.available()).toBe(true);

    const cases: [string, () => void][] = [
      ['offline', () => h.report(brightness(40), 'offline')],
      ['incompatible helper', () => h.report(brightness(40), 'needsAppUpdate')],
      ['no report yet', () => h.report(null)],
      ['no SteamVR session', () => h.report(brightness(40, { runtime: false, supported: false }))],
      ['unsupported', () => h.report(brightness(40, { supported: false }))],
      ['another HMD', () => h.devices.next([{ class: 'HMD', serialNumber: 'OTHER' } as OVRDevice])],
      ['SteamVR stopped', () => h.status.next('INACTIVE')],
      ['unfinished pairing', () => h.pairings.next([{ ...h.pairings.value[0], complete: false }])],
    ];
    for (const [name, change] of cases) {
      change();
      expect(await h.available(), name).toBe(false);
      h.status.next('INITIALIZED');
      h.devices.next([{ class: 'HMD', serialNumber: SERIAL } as OVRDevice]);
      h.pairings.next([{ ...h.pairings.value[0], complete: true }]);
      h.report(brightness(40));
      expect(await h.available(), `${name} restored`).toBe(true);
    }
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it('adopts each report with its bounds, clamped, and never writes it', async () => {
    const h = setup();
    h.report(brightness(40, { min: 20, max: 110 }));
    expect(h.driver.getBrightnessBounds()).toEqual([20, 110]);
    h.report(brightness(140, { min: 20, max: 110 }));
    h.report(brightness(5, { min: 20, max: 110 }));
    expect(h.updates).toEqual([40, 110, 20]);
    expect(await h.driver.getBrightnessPercentage()).toBe(20);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it('keeps one command in flight and sends only the newest waiting value', async () => {
    const h = setup();
    h.report(brightness(40));
    const replies: ((value: number) => void)[] = [];
    vi.mocked(invoke).mockImplementation(
      () => new Promise((resolve) => replies.push(resolve as (value: number) => void))
    );
    const first = h.driver.setBrightnessPercentage(50);
    void h.driver.setBrightnessPercentage(60);
    void h.driver.setBrightnessPercentage(70);
    // a report during the command leaves the requested value on screen
    h.report(brightness(45));
    expect(vi.mocked(invoke)).toHaveBeenCalledOnce();
    replies[0](50);
    await vi.waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith('steam_frame_set_brightness', {
      pairingId: 'pairing-1',
      percentage: 70,
    });
    replies[1](69.99);
    await first;
    expect(h.updates).toEqual([40, 69.99]);
  });

  it('shows the reported value after a failed command', async () => {
    const h = setup();
    h.report(brightness(40));
    vi.mocked(invoke).mockRejectedValue('offline');
    await h.driver.setBrightnessPercentage(80);
    expect(h.updates).toEqual([40, 40]);
  });

  it('lets HMD connect automations wait for the first report of a paired Frame', async () => {
    const h = setup();
    const waiting = h.driver.whenFrameReports();
    expect(waiting).not.toBeNull();
    h.report(brightness(40));
    expect(await waiting).toBe(true);

    // nothing waits once the Frame reported, or for another headset
    expect(h.driver.whenFrameReports()).toBeNull();
    h.devices.next([{ class: 'HMD', serialNumber: 'OTHER' } as OVRDevice]);
    expect(h.driver.whenFrameReports()).toBeNull();

    // a Frame that leaves before its report is never ready
    h.devices.next([{ class: 'HMD', serialNumber: SERIAL } as OVRDevice]);
    h.report(null);
    const leaving = h.driver.whenFrameReports();
    h.devices.next([]);
    expect(await leaving).toBe(false);
  });

  it('shows the new Frame, not a reply from the previous one, after a switch', async () => {
    const h = setup();
    h.report(brightness(40));
    let reply!: (value: number) => void;
    vi.mocked(invoke).mockImplementation(
      () => new Promise((resolve) => (reply = resolve as (value: number) => void))
    );
    const command = h.driver.setBrightnessPercentage(90);
    // a second paired Frame becomes the active HMD while the command runs
    h.pairings.next([
      ...h.pairings.value,
      {
        id: 'pairing-2',
        complete: true,
        identity: { serial: 'FPTEST000002' },
      } as SteamFramePairing,
    ]);
    h.devices.next([{ class: 'HMD', serialNumber: 'FPTEST000002' } as OVRDevice]);
    h.connections.next({
      ...h.connections.value,
      'pairing-2': {
        pairingId: 'pairing-2',
        status: 'connected',
        brightness: brightness(25),
      } as SteamFrameConnectionState,
    });
    reply(90);
    await command;
    expect(h.updates.at(-1)).toBe(25);
  });

  it('creates a fade for the reporting Frame, in hardware percent', async () => {
    const h = setup();
    const options = { target: 200, durationMs: 1000, shownTarget: 200, set: vi.fn() };
    expect(h.driver.fade(options)).toBeNull();
    h.report(brightness(40), 'connected', true);
    const fade = h.driver.fade(options)!;
    vi.mocked(invoke).mockResolvedValue(undefined);
    void fade.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledWith('steam_frame_fade', {
      pairingId: 'pairing-1',
      request: { control: 'brightness', target: 125, durationMs: 1000, operation: fade.operation },
    });
    expect(fade.targetBrightness).toBe(200);
    fade.cancel();
  });
});
