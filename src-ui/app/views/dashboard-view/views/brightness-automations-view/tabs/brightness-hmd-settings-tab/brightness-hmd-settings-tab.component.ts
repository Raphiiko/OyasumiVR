import { Component, DestroyRef, OnInit } from '@angular/core';
import { VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS } from '../../../../../../services/brightness-control/hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS } from '../../../../../../services/brightness-control/hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';
import { AppSettingsService } from '../../../../../../services/app-settings.service';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../../../../models/settings';
import { cloneDeep } from 'lodash';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { clamp } from '../../../../../../utils/number-utils';
import { HardwareBrightnessControlService } from '../../../../../../services/brightness-control/hardware-brightness-control.service';
import { SET_BRIGHTNESS_OPTIONS_DEFAULTS } from '../../../../../../services/brightness-control/brightness-control-models';

@Component({
  selector: 'app-brightness-hmd-settings-tab',
  templateUrl: './brightness-hmd-settings-tab.component.html',
  styleUrls: ['./brightness-hmd-settings-tab.component.scss'],
})
export class BrightnessHmdSettingsTabComponent implements OnInit {
  protected appSettings: AppSettings = cloneDeep(APP_SETTINGS_DEFAULT);

  constructor(
    private appSettingsService: AppSettingsService,
    private destroyRef: DestroyRef,
    private hardwareBrightness: HardwareBrightnessControlService
  ) {}

  ngOnInit() {
    this.appSettingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.appSettings = settings;
      });
  }

  get valveIndexMin() {
    return VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS.overdriveThreshold;
  }

  get valveIndexMax() {
    return VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS.riskThreshold;
  }

  get bigscreenBeyondMin() {
    return BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS.overdriveThreshold;
  }

  get bigscreenBeyondMax() {
    return this.appSettings.bigscreenBeyondUnsafeBrightness
      ? BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS.hardwareStops[
          BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS.hardwareStops.length - 1
        ]
      : BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS.riskThreshold;
  }

  toggleBigscreenBeyondForceFanBrightnessSafety() {
    this.appSettingsService.updateSettings({
      bigscreenBeyondBrightnessFanSafety: !this.appSettings.bigscreenBeyondBrightnessFanSafety,
    });
    // Set brightness to same value to reset fan safety if needed
    this.hardwareBrightness.setBrightness(
      this.hardwareBrightness.brightness,
      SET_BRIGHTNESS_OPTIONS_DEFAULTS,
      true
    );
  }

  toggleBigscreenBeyondUnsafeBrightness() {
    const allowUnsafeBrightness = !this.appSettings.bigscreenBeyondUnsafeBrightness;
    this.appSettingsService.updateSettings({
      bigscreenBeyondUnsafeBrightness: allowUnsafeBrightness,
    });
    // Reduce max brightness if unsafe brightness is disabled and the current value exceeds that.
    if (
      !allowUnsafeBrightness &&
      this.appSettings.bigscreenBeyondMaxBrightness >
        BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS.riskThreshold
    ) {
      this.appSettingsService.updateSettings({
        bigscreenBeyondMaxBrightness:
          BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS.riskThreshold,
      });
    }
  }

  changeValveIndexMaxBrightness(number: number) {
    number = clamp(number, this.valveIndexMin, this.valveIndexMax);
    this.appSettingsService.updateSettings({
      valveIndexMaxBrightness: number,
    });
  }

  changeBigscreenBeyondMaxBrightness(number: number) {
    number = clamp(number, this.bigscreenBeyondMin, this.bigscreenBeyondMax);
    this.appSettingsService.updateSettings({
      bigscreenBeyondMaxBrightness: number,
    });
  }
}
