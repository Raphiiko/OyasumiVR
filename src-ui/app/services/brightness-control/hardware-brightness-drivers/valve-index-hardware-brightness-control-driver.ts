import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { clamp, ensurePrecision, lerp } from '../../../utils/number-utils';
import { OpenVRService } from '../../openvr.service';
import { combineLatest, debounceTime, map, Observable } from 'rxjs';

export class ValveIndexHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  constructor(private openvr: OpenVRService) {
    super();
  }

  getBrightnessBounds(): HardwareBrightnessControlDriverBounds {
    return {
      softwareStops: [20, 160],
      hardwareStops: [20, 160],
      overdriveThreshold: 100,
      riskThreshold: 160,
    };
  }

  async getBrightnessPercentage(): Promise<number> {
    let analogGain = await this.openvr.getAnalogGain();
    analogGain = ensurePrecision(analogGain, 3);
    return this.analogGainToPercentage(analogGain);
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
    percentage = this.percentageToHardwareValue(percentage);
    const analogGain = this.percentageToAnalogGain(percentage);
    this.openvr.setAnalogGain(analogGain);
  }

  isAvailable(): Observable<boolean> {
    return combineLatest([this.openvr.status, this.openvr.devices]).pipe(
      debounceTime(0),
      map(([status, devices]) => {
        const hmd = devices.find((d) => d.class === 'HMD');
        return (
          status === 'INITIALIZED' &&
          !!hmd &&
          hmd.manufacturerName === 'Valve' &&
          hmd.modelNumber === 'Index'
        );
      })
    );
  }

  private analogGainToPercentage(analogGain: number): number {
    analogGain = ensurePrecision(analogGain, 3);
    // 1 and above is linear
    if (analogGain >= 1) return Math.round(clamp(analogGain * 100, 10, 160));
    // Why Volvo?
    // Why?
    // What is this?
    // What is the calculation?
    // Why is it not linear?
    // I don't understand.
    // Don't make me do this.
    // Show me the inner workings of your number magic ;_;
    // EDIT: Ok I figured this might have something to do with gamma correction.
    //       Remind me to look into this some later time when I've got fuck all to do.
    analogGain = clamp(analogGain, 0, 1);
    // Find surrounding samples
    const sampleKeys = Array.from(VALVE_INDEX_BRIGHTNESS_SAMPLE_MAP.keys());
    const lowerBound: number = parseFloat(
      [...sampleKeys].reverse().find((k) => parseFloat(k) <= analogGain)!
    );
    const upperBound: number =
      lowerBound == 1 ? 1 : parseFloat(sampleKeys[sampleKeys.indexOf(lowerBound.toString()) + 1]);
    // Linearly interpolate between the two samples
    return ensurePrecision(
      lerp(
        VALVE_INDEX_BRIGHTNESS_SAMPLE_MAP.get(lowerBound.toString())!,
        VALVE_INDEX_BRIGHTNESS_SAMPLE_MAP.get(upperBound.toString())!,
        (analogGain - lowerBound) / (upperBound - lowerBound)
      ),
      0
    );
  }

  private percentageToAnalogGain(percentage: number): number {
    // 100 and above are linear
    if (percentage >= 100) return ensurePrecision(clamp(percentage / 100, 1, 1.6), 2);
    // Valve whyyyyyyyyyyyyyyYYYYYYYY  (edit: ???)
    const sampleMap = new Map(
      [...VALVE_INDEX_BRIGHTNESS_SAMPLE_MAP].map(([key, value]) => [
        value.toString(),
        parseFloat(key),
      ])
    );
    const sampleKeys = Array.from(sampleMap.keys());
    const lowerBound: number = parseFloat(
      [...sampleKeys].reverse().find((k) => parseFloat(k) <= percentage)!
    );
    const upperBound: number =
      lowerBound == 100
        ? 100
        : parseFloat(sampleKeys[sampleKeys.indexOf(lowerBound.toString()) + 1]);
    // Linearly interpolate between the two samples
    return ensurePrecision(
      lerp(
        sampleMap.get(lowerBound.toString())!,
        sampleMap.get(upperBound.toString())!,
        upperBound == lowerBound ? 0.5 : (percentage - lowerBound) / (upperBound - lowerBound)
      ),
      3
    );
  }
}

// ANALOG_GAIN: PERCENTAGE
// Please forgive me for this.
const VALVE_INDEX_BRIGHTNESS_SAMPLE_MAP: Map<string, number> = new Map([
  ['0.03', 20],
  ['0.04', 23],
  ['0.05', 26],
  ['0.055', 27],
  ['0.06', 28],
  ['0.07', 30],
  ['0.08', 32],
  ['0.09', 33],
  ['0.095', 34],
  ['0.1', 35],
  ['0.105', 36],
  ['0.11', 37],
  ['0.115', 37],
  ['0.12', 38],
  ['0.125', 39],
  ['0.13', 40],
  ['0.135', 40],
  ['0.14', 41],
  ['0.145', 42],
  ['0.15', 42],
  ['0.155', 43],
  ['0.16', 43],
  ['0.165', 44],
  ['0.17', 45],
  ['0.175', 45],
  ['0.18', 46],
  ['0.185', 46],
  ['0.19', 47],
  ['0.195', 48],
  ['0.2', 48],
  ['0.21', 49],
  ['0.25', 53],
  ['0.3', 58],
  ['0.315', 59],
  ['0.32', 60],
  ['0.33', 60],
  ['0.34', 61],
  ['0.35', 62],
  ['0.4', 66],
  ['0.445', 69],
  ['0.45', 70],
  ['0.46', 70],
  ['0.465', 71],
  ['0.47', 71],
  ['0.475', 71],
  ['0.48', 72],
  ['0.49', 72],
  ['0.5', 73],
  ['0.6', 79],
  ['0.7', 85],
  ['0.8', 90],
  ['0.9', 95],
  ['1', 100],
]);
