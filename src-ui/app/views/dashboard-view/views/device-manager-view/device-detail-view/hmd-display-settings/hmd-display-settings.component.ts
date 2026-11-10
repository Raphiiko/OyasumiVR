import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DMKnownDevice } from 'src-ui/app/models/device-manager';
import { APP_SETTINGS_DEFAULT, AppSettings } from 'src-ui/app/models/settings';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { SteamFrameService } from 'src-ui/app/services/steam-frame/steam-frame.service';
import { isSteamVrCctSupportedHmd } from 'src-ui/app/services/cct-control/cct-control-drivers/steamvr-cct-control-driver';
import { VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS as INDEX_BOUNDS } from 'src-ui/app/services/brightness-control/hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS as BEYOND_BOUNDS } from 'src-ui/app/services/brightness-control/hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';
import { STEAM_FRAME_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS as FRAME_BOUNDS } from 'src-ui/app/services/brightness-control/hardware-brightness-drivers/steam-frame-hardware-brightness-control-driver';

type HmdModel = 'VALVE_INDEX' | 'BIGSCREEN_BEYOND' | 'STEAM_FRAME' | 'PSVR2' | 'OTHER';
type MaxBrightnessKey =
  'valveIndexMaxBrightness' | 'bigscreenBeyondMaxBrightness' | 'steamFrameMaxBrightness';

interface MaxBrightness {
  key: MaxBrightnessKey;
  min: number;
  max: number;
  value: number;
}

/**
 * The brightness and colour temperature settings of a headset's device page. The settings are
 * global: one value per headset model, or one for every headset without a dedicated driver.
 */
@Component({
  selector: 'app-hmd-display-settings',
  templateUrl: './hmd-display-settings.component.html',
  standalone: false,
})
export class HmdDisplaySettingsComponent {
  readonly device = input.required<DMKnownDevice>();
  private readonly appSettingsService = inject(AppSettingsService);
  private readonly steamFrame = inject(SteamFrameService);
  protected readonly defaults = APP_SETTINGS_DEFAULT;
  protected readonly settings = toSignal(this.appSettingsService.settings, {
    initialValue: this.appSettingsService.settingsSync,
  });
  protected readonly model = computed(() => this.modelOf(this.device()));
  protected readonly maxBrightness = computed(() =>
    this.maxBrightnessFor(this.model(), this.settings())
  );
  /** True for a model whose brightness only the opt-in SteamVR analog gain driver controls. */
  protected readonly brightnessFallback = computed(() => this.model() === 'OTHER');
  protected readonly cctFallback = computed(() => {
    const device = this.device();
    if (this.model() === 'STEAM_FRAME') return false;
    return !isSteamVrCctSupportedHmd({
      manufacturerName: device.manufacturer,
      modelNumber: device.typeName,
    });
  });
  protected readonly visible = computed(
    () =>
      this.device().deviceType === 'HMD' &&
      (!!this.maxBrightness() || this.brightnessFallback() || this.cctFallback())
  );

  /** Matches the headset drivers' own model checks, from the identity stored for the device. */
  private modelOf(device: DMKnownDevice): HmdModel {
    if (this.steamFrame.identityOf(device)) return 'STEAM_FRAME';
    if (device.manufacturer === 'Valve' && device.typeName === 'Index') return 'VALVE_INDEX';
    if (device.manufacturer === 'Bigscreen') return 'BIGSCREEN_BEYOND';
    if (device.manufacturer === 'SIE' && device.typeName === 'PS VR2') return 'PSVR2';
    return 'OTHER';
  }

  private maxBrightnessFor(model: HmdModel, settings: AppSettings): MaxBrightness | null {
    switch (model) {
      case 'VALVE_INDEX':
        return {
          key: 'valveIndexMaxBrightness',
          min: INDEX_BOUNDS.overdriveThreshold,
          max: INDEX_BOUNDS.riskThreshold,
          value: settings.valveIndexMaxBrightness,
        };
      case 'BIGSCREEN_BEYOND':
        return {
          key: 'bigscreenBeyondMaxBrightness',
          min: BEYOND_BOUNDS.overdriveThreshold,
          max: settings.bigscreenBeyondUnsafeBrightness
            ? BEYOND_BOUNDS.hardwareStops[BEYOND_BOUNDS.hardwareStops.length - 1]
            : BEYOND_BOUNDS.riskThreshold,
          value: settings.bigscreenBeyondMaxBrightness,
        };
      case 'STEAM_FRAME':
        return {
          key: 'steamFrameMaxBrightness',
          min: FRAME_BOUNDS.overdriveThreshold,
          max: FRAME_BOUNDS.riskThreshold,
          value: settings.steamFrameMaxBrightness,
        };
      default:
        return null;
    }
  }

  setMaxBrightness(value: number) {
    const max = this.maxBrightness();
    if (!max) return;
    this.appSettingsService.updateSettings({
      [max.key]: Math.min(Math.max(value, max.min), max.max),
    });
  }

  toggleBeyondSafeBrightness() {
    const unsafe = !this.settings().bigscreenBeyondUnsafeBrightness;
    this.appSettingsService.updateSettings({
      bigscreenBeyondUnsafeBrightness: unsafe,
      bigscreenBeyondMaxBrightness: unsafe
        ? this.settings().bigscreenBeyondMaxBrightness
        : Math.min(this.settings().bigscreenBeyondMaxBrightness, BEYOND_BOUNDS.riskThreshold),
    });
  }

  toggleBeyondFanSafety() {
    this.appSettingsService.updateSettings({
      bigscreenBeyondBrightnessFanSafety: !this.settings().bigscreenBeyondBrightnessFanSafety,
    });
  }

  toggleBrightnessFallback() {
    this.appSettingsService.updateSettings({
      hardwareBrightnessOnUnsupportedHmds: !this.settings().hardwareBrightnessOnUnsupportedHmds,
    });
  }

  toggleCctFallback() {
    this.appSettingsService.updateSettings({
      cctControlOnUnsupportedHmds: !this.settings().cctControlOnUnsupportedHmds,
    });
  }
}
