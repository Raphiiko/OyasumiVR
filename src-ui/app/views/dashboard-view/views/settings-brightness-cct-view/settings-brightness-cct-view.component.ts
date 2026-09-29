import { Component, DestroyRef, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../../models/settings';
import { AppSettingsService } from '../../../../services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS } from '../../../../services/brightness-control/hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS } from '../../../../services/brightness-control/hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';
import { clamp } from '../../../../utils/number-utils';
import { OpenVRService } from '../../../../services/openvr.service';
import { isSteamVrCctSupportedHmd } from '../../../../services/cct-control/cct-control-drivers/steamvr-cct-control-driver';
import { vshrink } from '../../../../utils/animations';

@Component({
  selector: 'app-settings-brightness-cct-view',
  templateUrl: './settings-brightness-cct-view.component.html',
  styleUrl: './settings-brightness-cct-view.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
  animations: [vshrink()],
})
export class SettingsBrightnessCctViewComponent implements OnInit {
  protected appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);
  protected hmdConnected = false;
  /** True while the active HMD is on the SteamVR color temperature list. */
  protected listedHmd = false;
  /** True while an HMD is active that is not on the list; only then can the setting change. */
  protected unlistedHmd = false;

  constructor(
    private appSettingsService: AppSettingsService,
    private openvr: OpenVRService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit() {
    this.appSettingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.appSettings = settings;
      });
    this.openvr.devices.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((devices) => {
      const hmd = devices.find((d) => d.index === 0 && d.class === 'HMD');
      this.listedHmd = !!hmd && isSteamVrCctSupportedHmd(hmd);
      this.hmdConnected = !!hmd;
      this.unlistedHmd = this.hmdConnected && !this.listedHmd;
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

  toggleCCTControlOnUnsupportedHmds() {
    this.appSettingsService.updateSettings({
      cctControlOnUnsupportedHmds: !this.appSettings.cctControlOnUnsupportedHmds,
    });
  }
}
