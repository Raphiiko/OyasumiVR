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
import { HardwareBrightnessControlService } from '../../../../services/brightness-control/hardware-brightness-control.service';
import { analogGainRange } from '../../../../services/brightness-control/hardware-brightness-drivers/analog-gain-hardware-brightness-control-driver';
import { combineLatest } from 'rxjs';

/** Whether the analog gain fallback can apply to the active HMD, and why not. */
type HardwareBrightnessState = 'NO_HMD' | 'LISTED' | 'NO_ANALOG_GAIN' | 'UNLISTED';

@Component({
  selector: 'app-settings-brightness-cct-view',
  templateUrl: './settings-brightness-cct-view.component.html',
  styleUrl: './settings-brightness-cct-view.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
  animations: [vshrink()],
})
export class SettingsBrightnessCctViewComponent implements OnInit {
  protected readonly defaults = APP_SETTINGS_DEFAULT;
  protected appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);
  protected hmdConnected = false;
  /** The active HMD's allowlist identity; null while no HMD is connected. */
  protected hmd: { manufacturer: string; model: string } | null = null;
  /** True while the active HMD is on the SteamVR color temperature list. */
  protected listedHmd = false;
  /** True while an HMD is active that is not on the list; only then can the setting change. */
  protected unlistedHmd = false;
  protected hardwareBrightnessState: HardwareBrightnessState = 'NO_HMD';

  constructor(
    private appSettingsService: AppSettingsService,
    private openvr: OpenVRService,
    private hardwareBrightness: HardwareBrightnessControlService,
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
      this.hmd = hmd
        ? { manufacturer: hmd.manufacturerName ?? '', model: hmd.modelNumber ?? '' }
        : null;
      this.unlistedHmd = this.hmdConnected && !this.listedHmd;
    });
    combineLatest([this.openvr.devices, this.hardwareBrightness.headsetDriverIsAvailable])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([devices, headsetDriverIsAvailable]) => {
        const hmd = devices.find((d) => d.index === 0 && d.class === 'HMD');
        if (!hmd) this.hardwareBrightnessState = 'NO_HMD';
        else if (headsetDriverIsAvailable) this.hardwareBrightnessState = 'LISTED';
        else if (!analogGainRange(hmd)) this.hardwareBrightnessState = 'NO_ANALOG_GAIN';
        else this.hardwareBrightnessState = 'UNLISTED';
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

  toggleHardwareBrightnessOnUnsupportedHmds() {
    this.appSettingsService.updateSettings({
      hardwareBrightnessOnUnsupportedHmds: !this.appSettings.hardwareBrightnessOnUnsupportedHmds,
    });
  }

  toggleCCTControlOnUnsupportedHmds() {
    this.appSettingsService.updateSettings({
      cctControlOnUnsupportedHmds: !this.appSettings.cctControlOnUnsupportedHmds,
    });
  }
}
