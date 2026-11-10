import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../models/settings';
import type { OVRDevice } from '../../../models/ovr-device';
import type { Brightness, FadeRequest as SteamFrameFadeCommand } from 'src-ui/app/bindings';
import type { HardwareBrightnessFadeOptions } from './hardware-brightness-control-driver';
import type {
  SteamFrameConnectionState,
  SteamFrameFadeEnded,
  SteamFramePairing,
} from '../../../models/steam-frame';
import type { OpenVRStatus } from '../../openvr.service';
import { SteamFrameHardwareBrightnessControlDriver } from './steam-frame-hardware-brightness-control-driver';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-log', () => ({ warn: vi.fn() }));

const SERIAL = 'FPTEST000001';

function brightness(percentage: number, overrides: Partial<Brightness> = {}) {
  return { runtime: true, supported: true, min: 9, max: 125, percentage, ...overrides };
}

function setup(initial: Partial<AppSettings> = {}) {
  const status = new BehaviorSubject<OpenVRStatus>('INITIALIZED');
  const devices = new BehaviorSubject<OVRDevice[]>([
    { class: 'HMD', isConnected: true, serialNumber: SERIAL } as OVRDevice,
  ]);
  const pairings = new BehaviorSubject<SteamFramePairing[]>([
    { id: 'pairing-1', complete: true, identity: { serial: SERIAL } } as SteamFramePairing,
  ]);
  const connections = new BehaviorSubject<Record<string, SteamFrameConnectionState>>({});
  const settings = new BehaviorSubject({ ...structuredClone(APP_SETTINGS_DEFAULT), ...initial });
  const driver = new SteamFrameHardwareBrightnessControlDriver(
    settings,
    { status, devices },
    pairings,
    connections,
    new Subject<SteamFrameFadeEnded>()
  );
  const updates: number[] = [];
  driver.brightnessUpdates.subscribe((value) => updates.push(value));
  const report = (value: Brightness | null, status = 'connected') =>
    connections.next({
      'pairing-1': {
        pairingId: 'pairing-1',
        status,
        brightness: value,
      } as SteamFrameConnectionState,
    });
  const available = () => firstValueFrom(driver.isAvailable());
  /** Sets this Frame's own maximum. */
  const setMax = (maxBrightness: number) =>
    settings.next({
      ...settings.value,
      hmdSettings: { [`OVR_HMD_${SERIAL}`]: { maxBrightness } },
    });
  return {
    status,
    devices,
    pairings,
    connections,
    settings,
    driver,
    updates,
    report,
    available,
    setMax,
  };
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
      [
        'not streaming here',
        () =>
          h.devices.next([{ class: 'HMD', isConnected: false, serialNumber: SERIAL } as OVRDevice]),
      ],
      [
        'another HMD',
        () =>
          h.devices.next([{ class: 'HMD', isConnected: true, serialNumber: 'OTHER' } as OVRDevice]),
      ],
      ['SteamVR stopped', () => h.status.next('INACTIVE')],
      ['unfinished pairing', () => h.pairings.next([{ ...h.pairings.value[0], complete: false }])],
    ];
    for (const [name, change] of cases) {
      change();
      expect(await h.available(), name).toBe(false);
      h.status.next('INITIALIZED');
      h.devices.next([{ class: 'HMD', isConnected: true, serialNumber: SERIAL } as OVRDevice]);
      h.pairings.next([{ ...h.pairings.value[0], complete: true }]);
      h.report(brightness(40));
      expect(await h.available(), `${name} restored`).toBe(true);
    }
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it('adopts each report clamped to the Frame range, and never writes it', async () => {
    const h = setup();
    // the helper's own range does not change OyasumiVR's
    h.report(brightness(40, { min: 20, max: 110 }));
    expect(h.driver.getBrightnessBounds()).toEqual([9, 125]);
    h.report(brightness(140));
    h.report(brightness(5));
    expect(h.updates).toEqual([40, 125, 9]);
    expect(await h.driver.getBrightnessPercentage()).toBe(9);
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

  it('keeps a waiting value while the HMD is briefly not connected here', async () => {
    const h = setup();
    vi.mocked(invoke).mockResolvedValue(70);
    await h.driver.setBrightnessPercentage(70);
    h.devices.next([{ class: 'HMD', isConnected: false, serialNumber: SERIAL } as OVRDevice]);
    h.report(brightness(40));
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    h.devices.next([{ class: 'HMD', isConnected: true, serialNumber: SERIAL } as OVRDevice]);
    await vi.waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('steam_frame_set_brightness', {
        pairingId: 'pairing-1',
        percentage: 70,
      })
    );
  });

  it('shows the reported value after a failed command', async () => {
    const h = setup();
    h.report(brightness(40));
    vi.mocked(invoke).mockRejectedValue('offline');
    await h.driver.setBrightnessPercentage(80);
    expect(h.updates).toEqual([40, 40]);
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
    h.devices.next([
      { class: 'HMD', isConnected: true, serialNumber: 'FPTEST000002' } as OVRDevice,
    ]);
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

  it('creates a fade only for a paired Frame that reports, in hardware percent', async () => {
    const h = setup();
    const options = { target: 200, durationMs: 1000, shownTarget: 200 };
    h.devices.next([{ class: 'HMD', isConnected: true, serialNumber: 'OTHER' } as OVRDevice]);
    expect(h.driver.fade(options)).toBeNull();
    h.devices.next([{ class: 'HMD', isConnected: true, serialNumber: SERIAL } as OVRDevice]);
    expect(h.driver.fade(options)).toBeNull();
    h.report(brightness(40));
    const fade = h.driver.fade(options)!;
    vi.mocked(invoke).mockResolvedValue(undefined);
    void fade.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledWith('steam_frame_fade', {
      pairingId: 'pairing-1',
      request: {
        control: 'brightness',
        target: 125,
        durationMs: 1000,
        simple: null,
        operation: fade.operation,
      },
    });
    expect(fade.targetBrightness).toBe(200);
    fade.cancel();
  });

  it('uses the global maximum while the Frame has none of its own', () => {
    const h = setup();
    h.report(brightness(40));
    h.settings.next({
      ...h.settings.value,
      steamFrameMaxBrightness: 110,
      hmdSettings: { OVR_HMD_FPOTHER00001: { maxBrightness: 100 } },
    });
    expect(h.driver.getBrightnessBounds()).toEqual([9, 110]);
  });

  it("limits a set to the user's maximum, and shows a report above it as it is", async () => {
    const h = setup();
    h.setMax(100);
    h.report(brightness(40));
    expect(h.driver.getBrightnessBounds()).toEqual([9, 100]);
    vi.mocked(invoke).mockResolvedValue(100);
    await h.driver.setBrightnessPercentage(120);
    expect(invoke).toHaveBeenCalledWith('steam_frame_set_brightness', {
      pairingId: 'pairing-1',
      percentage: 100,
    });
    h.report(brightness(115));
    expect(h.updates.at(-1)).toBe(115);
  });

  /** Starts a fade and resolves with the request the helper receives. */
  function sendFade(h: ReturnType<typeof setup>, options: HardwareBrightnessFadeOptions) {
    const fade = h.driver.fade(options)!;
    const sent = new Promise<SteamFrameFadeCommand>((resolve) =>
      vi.mocked(invoke).mockImplementation(async (command, args) => {
        if (command === 'steam_frame_fade')
          resolve((args as { request: SteamFrameFadeCommand }).request);
      })
    );
    void fade.start();
    return { fade, sent };
  }

  it.each([
    ['below the maximum', 100, { from: 5, to: 50 }, [9, 27.5, 50]],
    ['up to the maximum', 100, { from: 50, to: 100 }, [50, 75, 100]],
    ['across the hardware minimum', 100, { from: 0, to: 100 }, [9, 50, 100]],
    ['at the Frame maximum', 125, { from: 9, to: 100 }, [9, 67, 125]],
  ])(
    "sends a simple fade the helper maps within the user's maximum: %s",
    async (_, max, simple, [hardwareFrom, hardwareMid, hardwareTo]) => {
      const h = setup();
      h.setMax(max);
      h.report(brightness(40));
      const { fade, sent } = sendFade(h, { target: 0, durationMs: 1000, shownTarget: 0, simple });
      const curve = (await sent).simple!;
      // the helper's split over the Frame's reported range of 9% to 125%
      const helperSplit = (value: number) => (value < 9 ? 9 : 9 + (116 * (value - 9)) / 91);
      expect(helperSplit(curve.from)).toBeCloseTo(hardwareFrom);
      expect(helperSplit((curve.from + curve.to) / 2)).toBeCloseTo(hardwareMid);
      expect(helperSplit(curve.to)).toBeCloseTo(hardwareTo);
      fade.cancel();
    }
  );

  it.each([
    ['cancels a fade toward a target above it', 120, true],
    ['keeps a fade toward a target below it', 30, false],
  ])('on a lower maximum during a fade, %s', async (_, target, cancelled) => {
    const h = setup();
    h.report(brightness(40));
    const { fade, sent } = sendFade(h, { target, durationMs: 60_000, shownTarget: target });
    await sent;
    h.setMax(100);
    expect(fade.isCancelled()).toBe(cancelled);
    fade.cancel();
  });

  const noop = () => {};
  it.each([
    [
      'after the Frame stops streaming here',
      noop,
      (h: ReturnType<typeof setup>) =>
        h.devices.next([{ class: 'HMD', isConnected: false, serialNumber: SERIAL } as OVRDevice]),
    ],
    [
      'to the global maximum read while SteamVR was off',
      (h: ReturnType<typeof setup>) => {
        h.status.next('INACTIVE');
        h.settings.next({ ...h.settings.value, steamFrameMaxBrightness: 100 });
        h.status.next('INITIALIZED');
      },
      noop,
    ],
  ])("cancels a fade when the Frame's own maximum drops %s", async (_, before, during) => {
    const h = setup({ hmdSettings: { [`OVR_HMD_${SERIAL}`]: { maxBrightness: 125 } } });
    before(h);
    h.report(brightness(40));
    const { fade, sent } = sendFade(h, { target: 120, durationMs: 60_000, shownTarget: 120 });
    await sent;
    during(h);
    h.setMax(100);
    expect(fade.isCancelled()).toBe(true);
    fade.cancel();
  });
});
