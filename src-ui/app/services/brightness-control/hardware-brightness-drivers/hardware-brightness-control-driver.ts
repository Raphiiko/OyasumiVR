import { Observable } from 'rxjs';
import { clamp, lerp } from '../../../utils/number-utils';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../models/settings';

export interface HardwareBrightnessControlDriverBounds {
  softwareStops: number[]; // Percentages device stops are mapped to by the driver
  hardwareStops: number[]; // Percentages supported by the device
  overdriveThreshold: number; // Starting percentage for brightness overdrive
  riskThreshold: number; // Starting percentage where manufacturer (but not hardware) support stops
}

export abstract class HardwareBrightnessControlDriver {
  protected appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);

  constructor(protected appSettings$: Observable<AppSettings>) {
    this.appSettings$.subscribe((settings) => (this.appSettings = settings));
  }

  abstract getBrightnessPercentage(): Promise<number>;

  abstract setBrightnessPercentage(percentage: number): Promise<void>;

  abstract getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds;

  abstract getBrightnessBounds(appSettings?: AppSettings): [number, number];

  abstract isAvailable(): Observable<boolean>;

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
