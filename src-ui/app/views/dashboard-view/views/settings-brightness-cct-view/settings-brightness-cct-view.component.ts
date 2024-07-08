import { Component, DestroyRef } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../../models/settings';
import { AppSettingsService } from '../../../../services/app-settings.service';
import { HardwareBrightnessControlService } from '../../../../services/brightness-control/hardware-brightness-control.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS } from '../../../../services/brightness-control/hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS } from '../../../../services/brightness-control/hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';
import { SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS } from '../../../../services/brightness-control/brightness-control-models';
import { clamp } from '../../../../utils/number-utils';

@Component({
  selector: 'app-settings-brightness-cct-view',
  templateUrl: './settings-brightness-cct-view.component.html',
  styleUrl: './settings-brightness-cct-view.component.scss',
})
export class SettingsBrightnessCctViewComponent {
  protected appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);

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
      SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
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

  toggleCCTControl() {
    this.appSettingsService.updateSettings({
      cctControlEnabled: !this.appSettings.cctControlEnabled,
    });
  }
}
