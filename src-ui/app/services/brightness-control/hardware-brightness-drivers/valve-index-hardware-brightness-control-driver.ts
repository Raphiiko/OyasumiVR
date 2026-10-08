import { HardwareBrightnessControlDriverBounds } from './hardware-brightness-control-driver';
import { SteamVRAnalogGainHardwareBrightnessControlDriver } from './steamvr-analog-gain-hardware-brightness-control-driver';
import { clamp } from '../../../utils/number-utils';
import { AppSettings } from '../../../models/settings';
import { OVRDevice } from '../../../models/ovr-device';
import type { OpenVRService } from '../../openvr.service';
import {
  catchError,
  distinctUntilChanged,
  EMPTY,
  from,
  merge,
  Observable,
  ReplaySubject,
  Subject,
  switchMap,
  takeUntil,
  timer,
} from 'rxjs';
import { warn } from '@tauri-apps/plugin-log';

// Up to an analog gain of 1.0, the Index's panel maps gain to perceived
// brightness along a gamma curve: percentage = 100 * gain^(1/2.2). Past 1.0 the
// panel is driven linearly into overdrive, up to 1.6 (160%).
const VALVE_INDEX_BRIGHTNESS_GAMMA = 2.2;
const VALVE_INDEX_MAX_ANALOG_GAIN = 1.6;
const VALVE_INDEX_ANALOG_GAIN_RANGE: [number, number] = [0, VALVE_INDEX_MAX_ANALOG_GAIN];
/** SteamVR stores the gain as a 32-bit float, so a read-back differs slightly from the write. */
const ANALOG_GAIN_TOLERANCE = 1e-5;
const INITIAL_READ_DELAY_MS = 500;

export const VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [9, 160],
    hardwareStops: [9, 160],
    overdriveThreshold: 100,
    riskThreshold: 160,
  };

interface WrittenGain {
  target: number;
  gain: number;
}

/** Sets SteamVR's analog gain, and reports it when it changes outside OyasumiVR. */
export class ValveIndexHardwareBrightnessControlDriver extends SteamVRAnalogGainHardwareBrightnessControlDriver {
  override readonly pushesBrightnessChanges = true;
  /** Replays the latest value, which can arrive before the driver becomes the active one. */
  private readonly updates = new ReplaySubject<number>(1);
  override readonly brightnessUpdates = this.updates.asObservable();
  private isAvailableNow = false;
  /** Set while a write runs; a newer value waits in `pending` and replaces an older one. */
  private sending = false;
  private pending: number | null = null;
  /** Set when a report arrives during a write, which then reads the gain again before it ends. */
  private reportSkipped = false;
  /** Emits when a write is requested, which makes the initial read's value stale. */
  private readonly writeRequests = new Subject<void>();

  constructor(appSettings: Observable<AppSettings>, openvr: OpenVRService) {
    super(appSettings, openvr);
    this.isAvailable()
      .pipe(
        distinctUntilChanged(),
        switchMap((available) => {
          this.isAvailableNow = available;
          return available ? this.initialGain() : EMPTY;
        })
      )
      .subscribe((gain) => this.onGainReport(gain));
    this.openvr.analogGainUpdates.subscribe((gain) => this.onGainReport(gain));
  }

  protected servesHmd(hmd: OVRDevice): boolean {
    return hmd.manufacturerName === 'Valve' && hmd.modelNumber === 'Index';
  }

  protected gainRange(): [number, number] {
    return VALVE_INDEX_ANALOG_GAIN_RANGE;
  }

  protected gainToHardwarePercentage(gain: number): number {
    if (gain >= 1) return gain * 100;
    return Math.pow(gain, 1 / VALVE_INDEX_BRIGHTNESS_GAMMA) * 100;
  }

  protected hardwarePercentageToGain(percentage: number): number {
    if (percentage >= 100) return percentage / 100;
    return Math.pow(clamp(percentage, 0, 100) / 100, VALVE_INDEX_BRIGHTNESS_GAMMA);
  }

  // the stops match one to one, and a gain above the user's maximum must read as what it is
  protected hardwarePercentageToSoftwarePercentage(percentage: number): number {
    return percentage;
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }

  getBrightnessBounds(appSettings?: AppSettings): [number, number] {
    const config = this.getBrightnessConfiguration();
    return [config.softwareStops[0], (appSettings ?? this.appSettings).valveIndexMaxBrightness];
  }

  override async setBrightnessPercentage(percentage: number): Promise<void> {
    this.writeRequests.next();
    this.pending = this.softwarePercentageToHardwarePercentage(percentage);
    if (this.sending) return;
    this.sending = true;

    // write the newest value until none waits, and read again after a skipped report
    let written: WrittenGain | null = null;
    let current: number | null = null;
    while (this.pending !== null || this.reportSkipped) {
      const target = this.pending;
      this.pending = null;
      this.reportSkipped = false;
      if (target !== null) written = await this.write(target);
      const held = await this.openvr.getAnalogGain().catch(() => null);
      current = held === null ? null : this.heldPercentage(held, written);
    }
    this.sending = false;

    // show the value SteamVR holds now, in place of the skipped reports
    if (current !== null) this.updates.next(this.clampToBounds(current));
  }

  /** Writes the gain; null when SteamVR refused it. */
  private async write(target: number): Promise<WrittenGain | null> {
    const [min, max] = VALVE_INDEX_ANALOG_GAIN_RANGE;
    const gain = clamp(this.hardwarePercentageToGain(target), min, max);
    return this.openvr.setAnalogGain(gain).then(
      () => ({ target, gain }),
      (e) => {
        warn(`[ValveIndexHardwareBrightnessControlDriver] Could not set the analog gain: ${e}`);
        return null;
      }
    );
  }

  /** The written target while SteamVR still holds it, so the value shows unrounded. */
  private heldPercentage(held: number, written: WrittenGain | null): number {
    if (written && Math.abs(held - written.gain) < ANALOG_GAIN_TOLERANCE) return written.target;
    return Math.round(this.gainToSoftwarePercentage(held, VALVE_INDEX_ANALOG_GAIN_RANGE));
  }

  /**
   * SteamVR's gain shortly after the Index becomes available.
   * A report or a write that comes first is newer, so the read's value is dropped.
   */
  private initialGain(): Observable<number> {
    return timer(INITIAL_READ_DELAY_MS).pipe(
      switchMap(() => from(this.openvr.getAnalogGain()).pipe(catchError(() => EMPTY))),
      takeUntil(merge(this.openvr.analogGainUpdates, this.writeRequests))
    );
  }

  /** Adopts a reported gain, unless a write runs: then the write reads the gain again. */
  private onGainReport(gain: number) {
    if (!this.isAvailableNow) return;
    if (this.sending) {
      this.reportSkipped = true;
      return;
    }
    const percentage = this.gainToSoftwarePercentage(gain, VALVE_INDEX_ANALOG_GAIN_RANGE);
    this.updates.next(this.clampToBounds(Math.round(percentage)));
  }

  /** A value outside the bounds, such as one SteamVR's own slider set, shows clamped. */
  private clampToBounds(percentage: number): number {
    const [min, max] = this.getBrightnessBounds();
    return clamp(percentage, min, max);
  }
}
