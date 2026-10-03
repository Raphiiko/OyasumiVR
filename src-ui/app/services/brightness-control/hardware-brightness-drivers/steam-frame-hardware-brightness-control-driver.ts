import { invoke } from '@tauri-apps/api/core';
import { warn } from '@tauri-apps/plugin-log';
import { isEqual } from 'lodash';
import {
  combineLatest,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  Observable,
  ReplaySubject,
  shareReplay,
} from 'rxjs';
import { AppSettings } from '../../../models/settings';
import { OVRDevice } from '../../../models/ovr-device';
import type { OpenVRService, OpenVRStatus } from '../../openvr.service';
import {
  SteamFrameBrightness,
  SteamFrameConnectionState,
  SteamFrameFadeEnded,
  SteamFramePairing,
} from '../../../models/steam-frame';
import {
  SteamFrameBrightnessFade,
  SteamFrameFadeRequest,
} from '../../steam-frame/steam-frame-fade-task';
import { clamp } from '../../../utils/number-utils';
import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';

export const STEAM_FRAME_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [9, 125],
    hardwareStops: [9, 125],
    overdriveThreshold: 100,
    riskThreshold: 125,
  };

/** The active HMD: no HMD, a headset without a pairing, or a paired Frame. */
type ActiveHmd =
  | { kind: 'none' | 'other' }
  | { kind: 'frame'; pairingId: string; brightness: SteamFrameBrightness | null };

export interface SteamFrameBrightnessFadeOptions {
  /** Hardware brightness in percent. */
  target: number;
  durationMs: number;
  simple?: SteamFrameFadeRequest['simple'];
  /** The target the UI shows, which differs from `target` for a simple-mode curve. */
  shownTarget: number;
  /** Runs once the helper accepts the fade. */
  onAccept?: () => void;
}

/** Sets a paired Steam Frame's brightness through its helper, which also reports it. */
export class SteamFrameHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  override readonly pushesBrightnessChanges = true;
  /** Replays the latest value, which can arrive before the driver becomes the active one. */
  private readonly updates = new ReplaySubject<number>(1);
  override readonly brightnessUpdates = this.updates.asObservable();
  private readonly hmd: Observable<ActiveHmd>;
  private readonly available: Observable<boolean>;
  /** The paired Frame's id while it is the active HMD, null for another HMD, undefined for none. */
  readonly activePairing: Observable<string | null | undefined>;
  private currentHmd: ActiveHmd = { kind: 'none' };
  private frame: { pairingId: string; brightness: SteamFrameBrightness } | null = null;
  /** Set while a command runs; a newer value waits in `pending` and replaces an older one. */
  private sending = false;
  private pending: number | null = null;

  constructor(
    appSettings: Observable<AppSettings>,
    openvr: Pick<OpenVRService, 'status' | 'devices'>,
    pairings: Observable<SteamFramePairing[]>,
    private readonly connections: Observable<Record<string, SteamFrameConnectionState>>,
    private readonly fadeEnded: Observable<SteamFrameFadeEnded>
  ) {
    super(appSettings);
    this.hmd = combineLatest([openvr.status, openvr.devices, pairings, connections]).pipe(
      map(([status, devices, pairings, connections]) =>
        this.activeHmd(status, devices, pairings, connections)
      ),
      distinctUntilChanged(isEqual),
      shareReplay(1)
    );
    this.activePairing = this.hmd.pipe(
      map((hmd) => (hmd.kind === 'none' ? undefined : hmd.kind === 'frame' ? hmd.pairingId : null)),
      distinctUntilChanged(),
      shareReplay(1)
    );
    this.available = this.hmd.pipe(
      map((hmd) => hmd.kind === 'frame' && this.usable(hmd.brightness)),
      distinctUntilChanged(),
      shareReplay(1)
    );
    this.hmd.subscribe((hmd) => this.onHmd(hmd));
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return STEAM_FRAME_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }

  getBrightnessBounds(): [number, number] {
    const brightness = this.frame?.brightness;
    if (!brightness || brightness.min === null || brightness.max === null) {
      const stops = STEAM_FRAME_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS.hardwareStops;
      return [stops[0], stops[stops.length - 1]];
    }
    return [brightness.min, brightness.max];
  }

  async getBrightnessPercentage(): Promise<number> {
    return this.reportedPercentage() ?? 100;
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
    this.pending = this.softwarePercentageToHardwarePercentage(percentage);
    if (this.sending) return;
    this.sending = true;

    // send the newest value until none waits
    let applied: number | null = null;
    let sentTo: string | null = null;
    while (this.pending !== null && this.frame) {
      const target = this.pending;
      this.pending = null;
      sentTo = this.frame.pairingId;
      applied = await invoke<number>('steam_frame_set_brightness', {
        pairingId: sentTo,
        percentage: target,
      }).catch((e) => {
        warn(`[SteamFrameHardwareBrightnessControlDriver] Could not set brightness: ${e}`);
        return null;
      });
    }
    this.sending = false;
    this.pending = null;

    // show what the active headset holds now; a reply from a Frame that stopped being active is stale
    const replyApplies = applied !== null && sentTo === this.frame?.pairingId;
    const current = replyApplies ? applied : this.reportedPercentage();
    if (current !== null) this.updates.next(current);
  }

  isAvailable(): Observable<boolean> {
    return this.available;
  }

  /** A fade the active Frame's helper runs, or null while no Frame reports. Drops a waiting set. */
  fade(options: SteamFrameBrightnessFadeOptions): SteamFrameBrightnessFade | null {
    if (!this.frame) return null;
    // a waiting set would go out after the fade and supersede it
    this.pending = null;
    const request: SteamFrameFadeRequest = {
      pairingId: this.frame.pairingId,
      control: 'brightness',
      target: this.softwarePercentageToHardwarePercentage(options.target),
      durationMs: options.durationMs,
      simple: options.simple,
    };
    const frames = { connections$: this.connections, fadeEnded$: this.fadeEnded };
    return new SteamFrameBrightnessFade(options.shownTarget, request, frames, options.onAccept);
  }

  /** A paired Frame that is the active HMD becomes available with its first report. */
  override whenDeviceReady(): Promise<boolean> | null {
    const waiting = this.currentHmd;
    if (waiting.kind !== 'frame' || this.frame) return null;
    const isWaitingFrame = (hmd: ActiveHmd) =>
      hmd.kind === 'frame' && hmd.pairingId === waiting.pairingId;
    return firstValueFrom(
      combineLatest([this.hmd, this.available]).pipe(
        filter(([hmd, available]) => available || !isWaitingFrame(hmd)),
        map(([hmd, available]) => available && isWaitingFrame(hmd))
      )
    );
  }

  private activeHmd(
    status: OpenVRStatus,
    devices: OVRDevice[],
    pairings: SteamFramePairing[],
    connections: Record<string, SteamFrameConnectionState>
  ): ActiveHmd {
    const serial = devices.find((d) => d.class === 'HMD')?.serialNumber;
    if (status !== 'INITIALIZED' || !serial) return { kind: 'none' };
    const pairing = pairings.find((p) => p.complete && p.identity.serial === serial);
    if (!pairing) return { kind: 'other' };
    const state = connections[pairing.id];
    const brightness = state?.status === 'connected' ? (state.brightness ?? null) : null;
    return { kind: 'frame', pairingId: pairing.id, brightness };
  }

  private usable(brightness: SteamFrameBrightness | null): brightness is SteamFrameBrightness {
    return !!brightness?.supported && brightness.percentage !== null;
  }

  /** Adopts each report, unless a command runs: then the requested value stays on screen. */
  private onHmd(hmd: ActiveHmd) {
    this.currentHmd = hmd;
    if (hmd.kind !== 'frame' || !this.usable(hmd.brightness)) {
      this.frame = null;
      return;
    }
    this.frame = { pairingId: hmd.pairingId, brightness: hmd.brightness };
    if (this.sending) return;
    const current = this.reportedPercentage();
    if (current !== null) this.updates.next(current);
  }

  /** The reported value within the bounds, so a value outside them shows clamped. */
  private reportedPercentage(): number | null {
    const percentage = this.frame?.brightness.percentage ?? null;
    if (percentage === null) return null;
    const [min, max] = this.getBrightnessBounds();
    return clamp(percentage, min, max);
  }
}
