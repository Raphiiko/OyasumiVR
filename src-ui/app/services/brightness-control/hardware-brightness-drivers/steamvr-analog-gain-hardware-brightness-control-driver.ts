import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { clamp } from '../../../utils/number-utils';
import { OpenVRService } from '../../openvr.service';
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  Observable,
  pairwise,
  shareReplay,
} from 'rxjs';
import { AppSettings } from '../../../models/settings';
import { OVRDevice } from '../../../models/ovr-device';

// Without a known panel curve, the reported gain range maps linearly onto 20% to 100%.
export const STEAMVR_ANALOG_GAIN_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [20, 100],
    hardwareStops: [0, 100],
    overdriveThreshold: 100,
    riskThreshold: 100,
  };

// SteamVR's own analogGain range, for headsets that report none
const DEFAULT_ANALOG_GAIN_RANGE: [number, number] = [0, 1];
// SteamVR applies this gain until something writes analogGain
const DEFAULT_ANALOG_GAIN = 1;

/** The HMD's reported analog gain range, or SteamVR's default range when it reports no usable one. */
export function analogGainRange(hmd: OVRDevice): [number, number] {
  const min = hmd.displayMinAnalogGain;
  const max = hmd.displayMaxAnalogGain;
  if (typeof min !== 'number' || typeof max !== 'number') return DEFAULT_ANALOG_GAIN_RANGE;
  if (!isFinite(min) || !isFinite(max) || max <= min) return DEFAULT_ANALOG_GAIN_RANGE;
  return [min, max];
}

/**
 * Controls brightness through SteamVR's analogGain setting. On its own it serves any headset
 * without a dedicated driver once the user opts in. Headset drivers extend it with their own
 * headset match, gain range and panel curve.
 */
export class SteamVRAnalogGainHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  /** The connected HMD's gain range, also while this driver does not serve it; null without an HMD. */
  private range: [number, number] | null = null;
  private readonly available: Observable<boolean>;
  /** Emits the new range when a connected HMD's range changes from one usable range to another. */
  public readonly rangeChanges: Observable<[number, number]>;

  constructor(
    appSettings: Observable<AppSettings>,
    protected openvr: OpenVRService
  ) {
    super(appSettings);
    const state = combineLatest([this.openvr.status, this.openvr.devices, appSettings]).pipe(
      debounceTime(0),
      map(([status, devices, settings]) => {
        const hmd = devices.find((d) => d.index === 0 && d.class === 'HMD');
        if (status !== 'INITIALIZED' || !hmd) {
          this.range = null;
          return { range: null, served: false };
        }
        this.range = this.gainRange(hmd);
        return { range: this.range, served: this.servesHmd(hmd, settings) };
      }),
      shareReplay(1)
    );
    this.available = state.pipe(
      map(({ served }) => served),
      shareReplay(1)
    );
    this.rangeChanges = state.pipe(
      map(({ range }) => range),
      distinctUntilChanged((a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1]),
      pairwise(),
      filter((pair): pair is [[number, number], [number, number]] => !!pair[0] && !!pair[1]),
      map(([, range]) => range)
    );
  }

  protected servesHmd(_hmd: OVRDevice, settings: AppSettings): boolean {
    return settings.hardwareBrightnessOnUnsupportedHmds;
  }

  protected gainRange(hmd: OVRDevice): [number, number] {
    return analogGainRange(hmd);
  }

  /** Maps a gain inside the range to the panel's hardware percentage. */
  protected gainToHardwarePercentage(gain: number, [min, max]: [number, number]): number {
    return ((gain - min) / (max - min)) * 100;
  }

  /** Maps a hardware percentage to a gain; the caller clamps the result to the range. */
  protected hardwarePercentageToGain(percentage: number, [min, max]: [number, number]): number {
    return min + ((max - min) * percentage) / 100;
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return STEAMVR_ANALOG_GAIN_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }

  getBrightnessBounds(_appSettings?: AppSettings): [number, number] {
    const stops = this.getBrightnessConfiguration().softwareStops;
    return [stops[0], stops[stops.length - 1]];
  }

  async getBrightnessPercentage(): Promise<number> {
    // SteamVR can stop during the read and clear this.range, so keep the range it started with
    const range = this.range;
    if (!range) return 100;
    const storedGain = await this.openvr.getAnalogGain().catch(() => DEFAULT_ANALOG_GAIN);
    return Math.round(this.gainToSoftwarePercentage(storedGain, range));
  }

  /** Maps a gain SteamVR holds, also one outside the range, to an unrounded software percentage. */
  protected gainToSoftwarePercentage(storedGain: number, range: [number, number]): number {
    const gain = clamp(storedGain, range[0], range[1]);
    const stops = this.getBrightnessConfiguration().hardwareStops;
    const hardwarePercentage = clamp(
      this.gainToHardwarePercentage(gain, range),
      stops[0],
      stops[stops.length - 1]
    );
    return this.hardwarePercentageToSoftwarePercentage(hardwarePercentage);
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
    if (!this.range) return;
    const hardwarePercentage = this.softwarePercentageToHardwarePercentage(percentage);
    const gain = this.hardwarePercentageToGain(hardwarePercentage, this.range);
    this.openvr.setAnalogGain(clamp(gain, this.range[0], this.range[1]));
  }

  /**
   * Writes the maximum gain, so a headset this driver dimmed is not left dim once it lets go.
   * Returns false without writing when no headset is connected.
   */
  restoreMaximumGain(): boolean {
    if (!this.range) return false;
    this.openvr.setAnalogGain(this.range[1]);
    return true;
  }

  isAvailable(): Observable<boolean> {
    return this.available;
  }
}
