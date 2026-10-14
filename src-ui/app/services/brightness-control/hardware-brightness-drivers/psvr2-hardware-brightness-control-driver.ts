import { HardwareBrightnessControlDriverBounds } from './hardware-brightness-control-driver';
import { SteamVRAnalogGainHardwareBrightnessControlDriver } from './steamvr-analog-gain-hardware-brightness-control-driver';
import { OVRDevice } from '../../../models/ovr-device';

// PSVR2Toolkit maps analogGain 0.0-1.0 onto the panel's 32 brightness steps:
// step = ceil(gain^(1/2.2) * 31), and advertises that range on the HMD.
const PSVR2_BRIGHTNESS_GAMMA = 2.2;

// The panel's lowest step still lights up, so it sits at 50% on OyasumiVR's scale.
export const PSVR2_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [50, 100],
    hardwareStops: [0, 100],
    overdriveThreshold: 100,
    riskThreshold: 100,
  };

export class PSVR2HardwareBrightnessControlDriver extends SteamVRAnalogGainHardwareBrightnessControlDriver {
  protected servesHmd(hmd: OVRDevice): boolean {
    return (
      hmd.manufacturerName === 'SIE' &&
      hmd.modelNumber === 'PS VR2' &&
      hmd.displaySupportsAnalogGain === true
    );
  }

  protected gainRange(): [number, number] {
    return [0, 1];
  }

  protected gainToHardwarePercentage(gain: number): number {
    return Math.pow(gain, 1 / PSVR2_BRIGHTNESS_GAMMA) * 100;
  }

  protected hardwarePercentageToGain(percentage: number): number {
    return Math.pow(percentage / 100, PSVR2_BRIGHTNESS_GAMMA);
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return PSVR2_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }
}
