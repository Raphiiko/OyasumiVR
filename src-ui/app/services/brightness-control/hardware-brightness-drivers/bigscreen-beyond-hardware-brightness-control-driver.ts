import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { clamp } from '../../../utils/number-utils';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  interval,
  Observable,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings } from '../../../models/settings';
import { listen } from '@tauri-apps/api/event';
import { warn } from '@tauri-apps/plugin-log';

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

  constructor(appSettings: Observable<AppSettings>) {
    super(appSettings);
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
    // When connecting the beyond, attempt loading the last saved brightness percentage from the driver utility's preference file
    this.connected.pipe(distinctUntilChanged(), filter(Boolean)).subscribe(async () => {
      const brightness = (await this.getBeyondDriverSavedBrightness()) ?? 100;
      this.lastSetBrightnessPercentage = this.hardwarePercentageToSoftwarePercentage(brightness);
      const swPercentage = this.hardwarePercentageToSoftwarePercentage(brightness);
      await this.setBrightnessPercentage(swPercentage);
    });
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }

  getBrightnessBounds(appSettings?: AppSettings): [number, number] {
    const config = this.getBrightnessConfiguration();
    return [
      config.softwareStops[0],
      (appSettings ?? this.appSettings).bigscreenBeyondMaxBrightness,
    ];
  }

  async getBrightnessPercentage(): Promise<number> {
    return this.lastSetBrightnessPercentage;
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
    if (!this.connected.value) return;
    const hwPercentage = this.softwarePercentageToHardwarePercentage(percentage);
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

  private getBeyondDriverSavedBrightness(): Promise<number | null> {
    return invoke<string>('bigscreen_beyond_get_saved_preferences').then((result) => {
      if (!result) return null;
      let preferences:
        | { brightness: number; overdrive: boolean; overdrive_brightness: number }
        | undefined;
      try {
        preferences = JSON.parse(result);
      } catch (e) {
        warn(
          '[BigscreenBeyondHardwareBrightnessControlDriver] Failed to parse saved preferences from Bigscreen Beyond driver utility: ' +
            e
        );
        return null;
      }
      if (
        !preferences ||
        !isFinite(preferences?.brightness) ||
        !isFinite(preferences?.overdrive_brightness)
      )
        return null;
      return preferences.overdrive ? preferences.overdrive_brightness : preferences.brightness;
    });
  }
}
