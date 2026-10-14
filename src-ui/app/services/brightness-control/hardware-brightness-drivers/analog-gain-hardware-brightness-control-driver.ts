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
export const ANALOG_GAIN_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [20, 100],
    hardwareStops: [0, 100],
    overdriveThreshold: 100,
    riskThreshold: 100,
  };

// SteamVR's own analogGain range, for headsets that report none
const DEFAULT_ANALOG_GAIN_RANGE: [number, number] = [0, 1];

/** The HMD's reported analog gain range, or SteamVR's default range when it reports no usable one. */
export function analogGainRange(hmd: OVRDevice): [number, number] {
  const min = hmd.displayMinAnalogGain;
  const max = hmd.displayMaxAnalogGain;
  if (typeof min !== 'number' || typeof max !== 'number') return DEFAULT_ANALOG_GAIN_RANGE;
  if (!isFinite(min) || !isFinite(max) || max <= min) return DEFAULT_ANALOG_GAIN_RANGE;
  return [min, max];
}

/** Writes SteamVR's analogGain on any headset without its own driver, when the user opts in. */
export class AnalogGainHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  /** The active HMD's range; null while unavailable. */
  private range: [number, number] | null = null;
  private readonly available: Observable<boolean>;
  /** Emits the new range when a connected HMD's range changes from one usable range to another. */
  public readonly rangeChanges: Observable<[number, number]>;

  constructor(
    appSettings: Observable<AppSettings>,
    private openvr: OpenVRService
  ) {
    super(appSettings);
    const state = combineLatest([this.openvr.status, this.openvr.devices, appSettings]).pipe(
      debounceTime(0),
      map(([status, devices, settings]) => {
        const hmd = devices.find((d) => d.index === 0 && d.class === 'HMD');
        this.range = status === 'INITIALIZED' && hmd ? analogGainRange(hmd) : null;
        return { range: this.range, enabled: settings.hardwareBrightnessOnUnsupportedHmds };
      }),
      shareReplay(1)
    );
    this.available = state.pipe(
      map(({ range, enabled }) => enabled && !!range),
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

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return ANALOG_GAIN_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }

  getBrightnessBounds(): [number, number] {
    const config = this.getBrightnessConfiguration();
    return [config.softwareStops[0], config.softwareStops[1]];
  }

  async getBrightnessPercentage(): Promise<number> {
    if (!this.range) return 100;
    const [min, max] = this.range;
    // SteamVR has no analogGain value until something writes one
    const storedGain = await this.openvr.getAnalogGain().catch(() => max);
    const analogGain = clamp(storedGain, min, max);
    const hardwarePercentage = ((analogGain - min) / (max - min)) * 100;
    return Math.round(this.hardwarePercentageToSoftwarePercentage(hardwarePercentage));
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
    if (!this.range) return;
    const [min, max] = this.range;
    percentage = clamp(this.softwarePercentageToHardwarePercentage(percentage), 0, 100);
    this.openvr.setAnalogGain(min + ((max - min) * percentage) / 100);
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
