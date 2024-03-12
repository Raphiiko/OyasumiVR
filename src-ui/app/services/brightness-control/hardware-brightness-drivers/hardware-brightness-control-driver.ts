import { Observable } from 'rxjs';
import { clamp, lerp } from '../../../utils/number-utils';

export interface HardwareBrightnessControlDriverBounds {
  softwareStops: number[]; // Percentages device stops are mapped to by the driver
  hardwareStops: number[]; // Percentages supported by the device
  overdriveThreshold: number; // Starting percentage for brightness overdrive
  riskThreshold: number; // Starting percentage where manufacturer (but not hardware) support stops
}

export abstract class HardwareBrightnessControlDriver {
  abstract getBrightnessPercentage(): Promise<number>;

  abstract setBrightnessPercentage(percentage: number): Promise<void>;

  abstract getBrightnessBounds(): HardwareBrightnessControlDriverBounds;

  abstract isAvailable(): Observable<boolean>;

  protected percentageToHardwareValue(percentage: number): number {
    const bounds = this.getBrightnessBounds();
    const min = bounds.softwareStops[0];
    // TODO: Limit this based on preferences
    const max = bounds.softwareStops[bounds.softwareStops.length - 1];
    percentage = clamp(percentage, min, max);
    const stops = bounds.softwareStops;
    let stopIndex = -1;
    for (let i = 0; i < stops.length - 1; i++) {
      if (stops[i] <= percentage && percentage <= stops[i + 1]) {
        stopIndex = i;
        break;
      }
    }
    if (stopIndex === -1) {
      throw new Error(
        `Could not map percentage (${percentage}%) to brightness stops ${JSON.stringify(bounds)}`
      );
    }
    const frac = (percentage - stops[stopIndex]) / (stops[stopIndex + 1] - stops[stopIndex]);
    return lerp(bounds.hardwareStops[stopIndex], bounds.hardwareStops[stopIndex + 1], frac);
  }
}
