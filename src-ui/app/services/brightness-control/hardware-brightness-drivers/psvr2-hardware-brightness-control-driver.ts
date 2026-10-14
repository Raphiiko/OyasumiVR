import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { clamp } from '../../../utils/number-utils';
import { OpenVRService } from '../../openvr.service';
import { combineLatest, debounceTime, map, Observable } from 'rxjs';
import { AppSettings } from '../../../models/settings';

// PSVR2Toolkit maps analogGain 0.0-1.0 onto the panel's 32 brightness steps:
// step = ceil(gain^(1/2.2) * 31), and advertises that range on the HMD.
const PSVR2_BRIGHTNESS_GAMMA = 2.2;

// The panel's lowest step still lights up, so it sits at 10% on OyasumiVR's scale.
export const PSVR2_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [10, 100],
    hardwareStops: [0, 100],
    overdriveThreshold: 100,
    riskThreshold: 100,
  };

export class PSVR2HardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  constructor(
    appSettings: Observable<AppSettings>,
    private openvr: OpenVRService
  ) {
    super(appSettings);
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return PSVR2_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }

  getBrightnessBounds(): [number, number] {
    const config = this.getBrightnessConfiguration();
    return [config.softwareStops[0], config.softwareStops[1]];
  }

  async getBrightnessPercentage(): Promise<number> {
    const analogGain = clamp(await this.openvr.getAnalogGain(), 0, 1);
    const hardwarePercentage = Math.pow(analogGain, 1 / PSVR2_BRIGHTNESS_GAMMA) * 100;
    return Math.round(this.hardwarePercentageToSoftwarePercentage(hardwarePercentage));
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
    percentage = this.softwarePercentageToHardwarePercentage(percentage);
    this.openvr.setAnalogGain(Math.pow(clamp(percentage, 0, 100) / 100, PSVR2_BRIGHTNESS_GAMMA));
  }

  isAvailable(): Observable<boolean> {
    return combineLatest([this.openvr.status, this.openvr.devices]).pipe(
      debounceTime(0),
      map(([status, devices]) => {
        const hmd = devices.find((d) => d.class === 'HMD');
        return (
          status === 'INITIALIZED' &&
          !!hmd &&
          hmd.manufacturerName === 'SIE' &&
          hmd.modelNumber === 'PS VR2' &&
          hmd.displaySupportsAnalogGain === true
        );
      })
    );
  }
}
