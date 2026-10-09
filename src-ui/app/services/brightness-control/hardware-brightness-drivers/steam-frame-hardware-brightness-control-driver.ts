import { invoke } from '@tauri-apps/api/core';
import { warn } from '@tauri-apps/plugin-log';
import { isEqual } from 'lodash';
import {
  combineLatest,
  distinctUntilChanged,
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
  STEAM_FRAME_WAITING_SET_MS,
} from '../../../models/steam-frame';
import {
  SteamFrameBrightnessFade,
  SteamFrameFadeRequest,
} from '../../steam-frame/steam-frame-fade-task';
import { clamp } from '../../../utils/number-utils';
import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
  HardwareBrightnessFadeOptions,
} from './hardware-brightness-control-driver';

export const STEAM_FRAME_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [9, 125],
    hardwareStops: [9, 125],
    overdriveThreshold: 100,
    riskThreshold: 125,
  };

/** The active HMD: a paired Frame, or none for no HMD and for a headset without a pairing. */
type ActiveHmd =
  { kind: 'none' } | { kind: 'frame'; pairingId: string; brightness: SteamFrameBrightness | null };

/** Sets a paired Steam Frame's brightness through its helper, which also reports it. */
export class SteamFrameHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  override readonly pushesBrightnessChanges = true;
  /** Replays the latest value, which can arrive before the driver becomes the active one. */
  private readonly updates = new ReplaySubject<number>(1);
  override readonly brightnessUpdates = this.updates.asObservable();
  private readonly hmd: Observable<ActiveHmd>;
  private readonly matching: Observable<boolean>;
  private readonly available: Observable<boolean>;
  private currentHmd: ActiveHmd = { kind: 'none' };
  private frame: { pairingId: string; brightness: SteamFrameBrightness } | null = null;
  /** Set while a command runs; a newer value waits in `pending` and replaces an older one. */
  private sending = false;
  /** Also holds a value set while the paired Frame cannot take it, which goes out once it can. */
  private pending: { percentage: number; pairingId: string; setAt: number } | null = null;

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
    this.matching = this.hmd.pipe(
      map((hmd) => hmd.kind === 'frame'),
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
    return STEAM_FRAME_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS.hardwareStops as [number, number];
  }

  async getBrightnessPercentage(): Promise<number> {
    return this.reportedPercentage() ?? 100;
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
    const hmd = this.currentHmd;
    if (hmd.kind !== 'frame') return;
    this.pending = { percentage, pairingId: hmd.pairingId, setAt: Date.now() };
    if (!this.sending && this.frame) await this.sendPending();
  }

  private async sendPending() {
    this.sending = true;

    // send the newest value until none waits; a Frame that cannot take it keeps it waiting
    let applied: number | null = null;
    let sentTo: string | null = null;
    while (this.pending && this.frame?.pairingId === this.pending.pairingId) {
      const { percentage } = this.pending;
      this.pending = null;
      sentTo = this.frame.pairingId;
      applied = await invoke<number>('steam_frame_set_brightness', {
        pairingId: sentTo,
        percentage: this.softwarePercentageToHardwarePercentage(percentage),
      }).catch((e) => {
        warn(`[SteamFrameHardwareBrightnessControlDriver] Could not set brightness: ${e}`);
        return null;
      });
    }
    this.sending = false;

    // show what the active headset holds now; a reply from a Frame that stopped being active is stale
    const replyApplies = applied !== null && sentTo === this.frame?.pairingId;
    const current = replyApplies ? applied : this.reportedPercentage();
    if (current !== null) this.updates.next(current);
  }

  isAvailable(): Observable<boolean> {
    return this.available;
  }

  /**
   * A fade the paired Frame's helper runs, or null while the active HMD is no Frame that reports.
   * Drops a waiting set.
   */
  override fade(options: HardwareBrightnessFadeOptions): SteamFrameBrightnessFade | null {
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

  override matches(): Observable<boolean> {
    return this.matching;
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
    if (!pairing) return { kind: 'none' };
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

    // a waiting value belongs to the Frame it was set for
    const pending = this.pending;
    if (pending && (hmd.kind !== 'frame' || hmd.pairingId !== pending.pairingId)) {
      this.pending = null;
    }
    if (hmd.kind !== 'frame' || !this.usable(hmd.brightness)) {
      this.frame = null;
      return;
    }
    this.frame = { pairingId: hmd.pairingId, brightness: hmd.brightness };
    if (this.sending) return;

    // a value set while the Frame could not take it goes out now, unless it waited too long
    if (this.pending && Date.now() - this.pending.setAt <= STEAM_FRAME_WAITING_SET_MS) {
      void this.sendPending();
      return;
    }
    this.pending = null;
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
