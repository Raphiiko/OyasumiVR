import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { clamp } from '../../../utils/number-utils';
import { OpenVRService } from '../../openvr.service';
import { combineLatest, debounceTime, map, Observable } from 'rxjs';
import { AppSettings } from '../../../models/settings';

// Up to an analog gain of 1.0, the Index's panel maps gain to perceived
// brightness along a gamma curve: percentage = 100 * gain^(1/2.2). Past 1.0 the
// panel is driven linearly into overdrive, up to 1.6 (160%).
const VALVE_INDEX_BRIGHTNESS_GAMMA = 2.2;
const VALVE_INDEX_MAX_ANALOG_GAIN = 1.6;

export const VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [20, 160],
    hardwareStops: [20, 160],
    overdriveThreshold: 100,
    riskThreshold: 160,
  };

export class ValveIndexHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  constructor(
    appSettings: Observable<AppSettings>,
    private openvr: OpenVRService
  ) {
    super(appSettings);
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
    percentage = this.softwarePercentageToHardwarePercentage(percentage);
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
    if (analogGain >= 1) return clamp(analogGain, 1, VALVE_INDEX_MAX_ANALOG_GAIN) * 100;
    return Math.pow(clamp(analogGain, 0, 1), 1 / VALVE_INDEX_BRIGHTNESS_GAMMA) * 100;
  }

  private percentageToAnalogGain(percentage: number): number {
    if (percentage >= 100) return clamp(percentage / 100, 1, VALVE_INDEX_MAX_ANALOG_GAIN);
    return Math.pow(clamp(percentage, 0, 100) / 100, VALVE_INDEX_BRIGHTNESS_GAMMA);
  }
}
