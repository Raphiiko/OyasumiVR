import { Observable } from 'rxjs';
import { clamp, lerp } from '../../../utils/number-utils';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../models/settings';
import { DeviceFade } from '../../../utils/device-fade';

export interface HardwareBrightnessControlDriverBounds {
  softwareStops: number[]; // Percentages device stops are mapped to by the driver
  hardwareStops: number[]; // Percentages supported by the device
  overdriveThreshold: number; // Starting percentage for brightness overdrive
  riskThreshold: number; // Starting percentage where manufacturer (but not hardware) support stops
}

/** What a service asks a driver to fade. */
export interface HardwareBrightnessFadeOptions {
  /** Brightness in the driver's percent, as `setBrightnessPercentage` takes it. */
  target: number;
  durationMs: number;
  /** A simple-mode curve, which the device maps to hardware brightness at every step. */
  simple?: { from: number; to: number };
  /** The target the UI shows, which differs from `target` for a simple-mode curve. */
  shownTarget: number;
  /** Runs once the device accepts the fade. */
  onAccept?: () => void;
}

/** A brightness fade the device runs; `targetBrightness` is the value the UI shows as the target. */
export type HardwareBrightnessFade = DeviceFade & { readonly targetBrightness: number };

export abstract class HardwareBrightnessControlDriver {
  protected appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);
  /**
   * True when the driver sends every brightness change the device makes. OyasumiVR shows that
   * value, and does not write its stored one when the driver's availability changes.
   */
  readonly pushesBrightnessChanges: boolean = false;
  /** Brightness values the device reported or applied. OyasumiVR shows them and never writes them back. */
  readonly brightnessUpdates?: Observable<number>;

  constructor(protected appSettings$: Observable<AppSettings>) {
    this.appSettings$.subscribe((settings) => (this.appSettings = settings));
  }

  abstract getBrightnessPercentage(): Promise<number>;

  abstract setBrightnessPercentage(percentage: number): Promise<void>;

  abstract getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds;

  abstract getBrightnessBounds(appSettings?: AppSettings): [number, number];

  /** Whether the device is connected and reports its brightness, for the UI and for reading it. */
  abstract isAvailable(): Observable<boolean>;

  /**
   * Whether the active HMD belongs to this driver. It gets every set and keeps or drops one it
   * cannot send yet.
   */
  matches(): Observable<boolean> {
    return this.isAvailable();
  }

  /** A fade the device runs itself, or null when it cannot run one now. */
  fade(_options: HardwareBrightnessFadeOptions): HardwareBrightnessFade | null {
    return null;
  }

  protected softwarePercentageToHardwarePercentage(percentage: number): number {
    const config = this.getBrightnessConfiguration();
    const bounds = this.getBrightnessBounds();
    percentage = clamp(percentage, bounds[0], bounds[1]);
    const stops = config.softwareStops;
    let stopIndex = -1;
    for (let i = 0; i < stops.length - 1; i++) {
      if (stops[i] <= percentage && percentage <= stops[i + 1]) {
        stopIndex = i;
        break;
      }
    }
    if (stopIndex === -1) {
      throw new Error(
        `Could not map software percentage (${percentage}%) to brightness stops ${JSON.stringify(
          config
        )}`
      );
    }
    const frac = (percentage - stops[stopIndex]) / (stops[stopIndex + 1] - stops[stopIndex]);
    return lerp(config.hardwareStops[stopIndex], config.hardwareStops[stopIndex + 1], frac);
  }

  protected hardwarePercentageToSoftwarePercentage(percentage: number): number {
    const config = this.getBrightnessConfiguration();
    const stops = config.hardwareStops;
    let stopIndex = -1;
    for (let i = 0; i < stops.length - 1; i++) {
      if (stops[i] <= percentage && percentage <= stops[i + 1]) {
        stopIndex = i;
        break;
      }
    }
    if (stopIndex === -1) {
      throw new Error(
        `Could not map hardware percentage (${percentage}%) to brightness stops ${JSON.stringify(
          config
        )}`
      );
    }
    const frac = (percentage - stops[stopIndex]) / (stops[stopIndex + 1] - stops[stopIndex]);
    const swPercentage = lerp(
      config.softwareStops[stopIndex],
      config.softwareStops[stopIndex + 1],
      frac
    );
    const bounds = this.getBrightnessBounds();
    return clamp(swPercentage, bounds[0], bounds[1]);
  }
}
