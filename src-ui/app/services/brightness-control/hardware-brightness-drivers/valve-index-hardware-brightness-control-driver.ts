import { HardwareBrightnessControlDriverBounds } from './hardware-brightness-control-driver';
import { SteamVRAnalogGainHardwareBrightnessControlDriver } from './steamvr-analog-gain-hardware-brightness-control-driver';
import { clamp } from '../../../utils/number-utils';
import { AppSettings } from '../../../models/settings';
import { OVRDevice } from '../../../models/ovr-device';

// Up to an analog gain of 1.0, the Index's panel maps gain to perceived
// brightness along a gamma curve: percentage = 100 * gain^(1/2.2). Past 1.0 the
// panel is driven linearly into overdrive, up to 1.6 (160%).
const VALVE_INDEX_BRIGHTNESS_GAMMA = 2.2;
const VALVE_INDEX_MAX_ANALOG_GAIN = 1.6;

export const VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [9, 160],
    hardwareStops: [9, 160],
    overdriveThreshold: 100,
    riskThreshold: 160,
  };

export class ValveIndexHardwareBrightnessControlDriver extends SteamVRAnalogGainHardwareBrightnessControlDriver {
  protected servesHmd(hmd: OVRDevice): boolean {
    return hmd.manufacturerName === 'Valve' && hmd.modelNumber === 'Index';
  }

  protected gainRange(): [number, number] {
    return [0, VALVE_INDEX_MAX_ANALOG_GAIN];
  }

  protected gainToHardwarePercentage(gain: number): number {
    if (gain >= 1) return gain * 100;
    return Math.pow(gain, 1 / VALVE_INDEX_BRIGHTNESS_GAMMA) * 100;
  }

  protected hardwarePercentageToGain(percentage: number): number {
    if (percentage >= 100) return percentage / 100;
    return Math.pow(clamp(percentage, 0, 100) / 100, VALVE_INDEX_BRIGHTNESS_GAMMA);
  }

  // the stops match one to one, and a gain above the user's maximum must read as what it is
  protected hardwarePercentageToSoftwarePercentage(percentage: number): number {
    return percentage;
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }

  getBrightnessBounds(appSettings?: AppSettings): [number, number] {
    const config = this.getBrightnessConfiguration();
    return [config.softwareStops[0], (appSettings ?? this.appSettings).valveIndexMaxBrightness];
  }
}
