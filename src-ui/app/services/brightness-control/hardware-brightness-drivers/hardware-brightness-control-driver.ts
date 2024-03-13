import { Observable } from 'rxjs';
import { clamp, lerp } from '../../../utils/number-utils';
import { AppSettings } from '../../../models/settings';

export interface HardwareBrightnessControlDriverBounds {
  softwareStops: number[]; // Percentages device stops are mapped to by the driver
  hardwareStops: number[]; // Percentages supported by the device
  overdriveThreshold: number; // Starting percentage for brightness overdrive
  riskThreshold: number; // Starting percentage where manufacturer (but not hardware) support stops
}

export abstract class HardwareBrightnessControlDriver {
  abstract getBrightnessPercentage(): Promise<number>;

  abstract setBrightnessPercentage(settings: AppSettings, percentage: number): Promise<void>;

  abstract getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds;

  abstract getBrightnessBounds(settings: AppSettings): [number, number];

  abstract isAvailable(): Observable<boolean>;

  protected percentageToHardwareValue(settings: AppSettings, percentage: number): number {
    const config = this.getBrightnessConfiguration();
    const bounds = this.getBrightnessBounds(settings);
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
        `Could not map percentage (${percentage}%) to brightness stops ${JSON.stringify(config)}`
      );
    }
    const frac = (percentage - stops[stopIndex]) / (stops[stopIndex + 1] - stops[stopIndex]);
    return lerp(config.hardwareStops[stopIndex], config.hardwareStops[stopIndex + 1], frac);
  }
}
