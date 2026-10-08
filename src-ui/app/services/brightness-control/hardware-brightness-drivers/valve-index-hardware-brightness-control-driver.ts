import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { clamp } from '../../../utils/number-utils';
import type { OpenVRService } from '../../openvr.service';
import {
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  from,
  map,
  merge,
  Observable,
  ReplaySubject,
  shareReplay,
  Subject,
  switchMap,
  takeUntil,
  timer,
} from 'rxjs';
import { warn } from '@tauri-apps/plugin-log';
import { AppSettings } from '../../../models/settings';

// Up to an analog gain of 1.0, the Index's panel maps gain to perceived
// brightness along a gamma curve: percentage = 100 * gain^(1/2.2). Past 1.0 the
// panel is driven linearly into overdrive, up to 1.6 (160%).
const VALVE_INDEX_BRIGHTNESS_GAMMA = 2.2;
const VALVE_INDEX_MAX_ANALOG_GAIN = 1.6;
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

type IndexOpenVR = Pick<
  OpenVRService,
  'status' | 'devices' | 'analogGainUpdates' | 'getAnalogGain' | 'setAnalogGain'
>;

/** Sets SteamVR's analog gain, and reports it when it changes outside OyasumiVR. */
export class ValveIndexHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  override readonly pushesBrightnessChanges = true;
  /** Replays the latest value, which can arrive before the driver becomes the active one. */
  private readonly updates = new ReplaySubject<number>(1);
  override readonly brightnessUpdates = this.updates.asObservable();
  private readonly available: Observable<boolean>;
  private isAvailableNow = false;
  /** Set while a write runs; a newer value waits in `pending` and replaces an older one. */
  private sending = false;
  private pending: number | null = null;
  /** Set when a report arrives during a write, which then reads the gain again before it ends. */
  private reportSkipped = false;
  /** Emits when a write is requested, which makes the initial read's value stale. */
  private readonly writeRequests = new Subject<void>();

  constructor(
    appSettings: Observable<AppSettings>,
    private openvr: IndexOpenVR
  ) {
    super(appSettings);
    this.available = combineLatest([this.openvr.status, this.openvr.devices]).pipe(
      debounceTime(0),
      map(([status, devices]) => {
        const hmd = devices.find((d) => d.class === 'HMD');
        return (
          status === 'INITIALIZED' &&
          !!hmd &&
          hmd.manufacturerName === 'Valve' &&
          hmd.modelNumber === 'Index'
        );
      }),
      distinctUntilChanged(),
      shareReplay(1)
    );
    this.available
      .pipe(
        switchMap((available) => {
          this.isAvailableNow = available;
          return available ? this.initialGain() : EMPTY;
        })
      )
      .subscribe((gain) => this.onGainReport(gain));
    this.openvr.analogGainUpdates.subscribe((gain) => this.onGainReport(gain));
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }

  getBrightnessBounds(appSettings?: AppSettings): [number, number] {
    const config = this.getBrightnessConfiguration();
    return [config.softwareStops[0], (appSettings ?? this.appSettings).valveIndexMaxBrightness];
  }

  async getBrightnessPercentage(): Promise<number> {
    return Math.round(this.analogGainToPercentage(await this.openvr.getAnalogGain()));
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
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

  isAvailable(): Observable<boolean> {
    return this.available;
  }

  /** Writes the gain; null when SteamVR refused it. */
  private async write(target: number): Promise<WrittenGain | null> {
    const gain = this.percentageToAnalogGain(target);
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
    return Math.round(this.analogGainToPercentage(held));
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
    this.updates.next(this.clampToBounds(Math.round(this.analogGainToPercentage(gain))));
  }

  /** A value outside the bounds, such as one SteamVR's own slider set, shows clamped. */
  private clampToBounds(percentage: number): number {
    const [min, max] = this.getBrightnessBounds();
    return clamp(percentage, min, max);
  }

  private analogGainToPercentage(analogGain: number): number {
    if (analogGain >= 1) return clamp(analogGain, 1, VALVE_INDEX_MAX_ANALOG_GAIN) * 100;
    return Math.pow(clamp(analogGain, 0, 1), 1 / VALVE_INDEX_BRIGHTNESS_GAMMA) * 100;
  }

  private percentageToAnalogGain(percentage: number): number {
    if (percentage >= 100) return clamp(percentage / 100, 1, VALVE_INDEX_MAX_ANALOG_GAIN);
    return Math.pow(clamp(percentage, 0, 100) / 100, VALVE_INDEX_BRIGHTNESS_GAMMA);
  }
}
