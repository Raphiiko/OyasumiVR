import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { clamp } from '../../../utils/number-utils';
import {
  BehaviorSubject,
  distinctUntilChanged,
  interval,
  Observable,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';
import { invoke } from '@tauri-apps/api';
import { AppSettings } from '../../../models/settings';
import { listen } from '@tauri-apps/api/event';

export const BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [10, 100, 237],
    hardwareStops: [-23, 100, 237],
    overdriveThreshold: 100,
    riskThreshold: 150,
  };

export class BigscreenBeyondHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  private lastSetBrightnessPercentage = 100;
  private connected = new BehaviorSubject(false);

  constructor() {
    super();
    listen<boolean>('BIGSCREEN_BEYOND_CONNECTED', (event) => {
      this.connected.next(event.payload);
    });
    interval(10000)
      .pipe(
        startWith(0),
        switchMap(() =>
          invoke<boolean>('bigscreen_beyond_is_connected').then((connected) => {
            this.connected.next(connected);
          })
        )
      )
      .subscribe();
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }

  getBrightnessBounds(settings: AppSettings): [number, number] {
    const config = this.getBrightnessConfiguration();
    return [config.softwareStops[0], settings.bigscreenBeyondMaxBrightness];
  }

  async getBrightnessPercentage(): Promise<number> {
    return this.lastSetBrightnessPercentage;
  }

  async setBrightnessPercentage(settings: AppSettings, percentage: number): Promise<void> {
    const hwPercentage = this.percentageToHardwareValue(settings, percentage);
    this.lastSetBrightnessPercentage = percentage;
    const hwValue = this.swValueToHWValue(hwPercentage);
    invoke('bigscreen_beyond_set_brightness', {
      brightness: hwValue,
    });
  }

  isAvailable(): Observable<boolean> {
    return this.connected.pipe(distinctUntilChanged(), shareReplay(1));
  }

  private swValueToHWValue(percentage: number) {
    percentage = clamp(percentage, -23, 237);
    const hwValue = Math.round(
      percentage <= 100 ? 2.1621 * percentage + 49.845 : 5.5259 * percentage - 286.7
    );
    return clamp(hwValue, 0, 1023);
  }
}
