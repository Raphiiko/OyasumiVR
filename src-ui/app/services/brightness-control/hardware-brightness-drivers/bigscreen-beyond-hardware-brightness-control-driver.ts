import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { clamp } from '../../../utils/number-utils';
import { OpenVRService } from '../../openvr.service';
import { combineLatest, debounceTime, map, Observable } from 'rxjs';
import { invoke } from '@tauri-apps/api';

export class BigscreenBeyondHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  private lastSetBrightnessPercentage: number = 100;

  constructor(private openvr: OpenVRService) {
    super();
  }

  getBrightnessBounds(): HardwareBrightnessControlDriverBounds {
    return {
      // softwareStops: [10, 100, 237],
      // hardwareStops: [-23, 100, 237],
      softwareStops: [10, 100, 150], // TODO: Remove artificial limit when proper warnings are in place
      hardwareStops: [-23, 100, 150], // TODO: Remove artificial limit when proper warnings are in place
      overdriveThreshold: 100,
      riskThreshold: 150,
    };
  }

  async getBrightnessPercentage(): Promise<number> {
    return this.lastSetBrightnessPercentage;
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
    const hwPercentage = this.percentageToHardwareValue(percentage);
    this.lastSetBrightnessPercentage = percentage;
    const hwValue = this.swValueToHWValue(hwPercentage);
    await invoke('bigscreen_beyond_set_brightness', { brightness: hwValue });
  }

  isAvailable(): Observable<boolean> {
    return combineLatest([this.openvr.status, this.openvr.devices]).pipe(
      debounceTime(0),
      map(([status, devices]) => {
        const hmd = devices.find((d) => d.class === 'HMD');
        return (
          status === 'INITIALIZED' &&
          !!hmd &&
          hmd.manufacturerName === 'Bigscreen' &&
          hmd.modelNumber === 'Beyond'
        );
      })
    );
  }

  private swValueToHWValue(percentage: number) {
    percentage = clamp(percentage, -23, 237);
    const hwValue = Math.round(
      percentage <= 100 ? 2.1621 * percentage + 49.845 : 5.5259 * percentage - 286.7
    );
    return clamp(hwValue, 0, 1023);
  }
}
