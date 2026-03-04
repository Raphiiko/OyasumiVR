import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { clamp, ensurePrecision, lerp } from '../../../utils/number-utils';
import { OpenVRService } from '../../openvr.service';
import { combineLatest, debounceTime, map, Observable } from 'rxjs';
import { AppSettings } from '../../../models/settings';

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
    let analogGain = await this.openvr.getAnalogGain();
    analogGain = ensurePrecision(analogGain, 3);
    return this.analogGainToPercentage(analogGain);
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
    if (analogGain >= 1) return analogGain * 100;
    return Math.pow(analogGain, 2.2) * 100;
  }

  private percentageToAnalogGain(percentage: number): number {
    if (percentage >= 100) return percentage / 100;
    return Math.pow(percentage / 100, 1 / 2.2);
  }
}
