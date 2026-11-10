import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DMKnownDevice } from 'src-ui/app/models/device-manager';
import { APP_SETTINGS_DEFAULT, AppSettings, HmdSettings } from 'src-ui/app/models/settings';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { SteamFrameService } from 'src-ui/app/services/steam-frame/steam-frame.service';
import { isSteamVrCctSupportedHmd } from 'src-ui/app/services/cct-control/cct-control-drivers/steamvr-cct-control-driver';
import { VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS as INDEX_BOUNDS } from 'src-ui/app/services/brightness-control/hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS as BEYOND_BOUNDS } from 'src-ui/app/services/brightness-control/hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';
import { STEAM_FRAME_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS as FRAME_BOUNDS } from 'src-ui/app/services/brightness-control/hardware-brightness-drivers/steam-frame-hardware-brightness-control-driver';

type HmdModel = 'VALVE_INDEX' | 'BIGSCREEN_BEYOND' | 'STEAM_FRAME' | 'PSVR2' | 'OTHER';
type GlobalMaxBrightnessKey =
  'valveIndexMaxBrightness' | 'bigscreenBeyondMaxBrightness' | 'steamFrameMaxBrightness';

const GLOBAL_MAX_BRIGHTNESS: Partial<Record<HmdModel, GlobalMaxBrightnessKey>> = {
  VALVE_INDEX: 'valveIndexMaxBrightness',
  BIGSCREEN_BEYOND: 'bigscreenBeyondMaxBrightness',
  STEAM_FRAME: 'steamFrameMaxBrightness',
};

/** This headset's values, each one falling back to the global setting it replaces. */
interface Resolved {
  maxBrightness: number | null;
  unsafeBrightness: boolean;
  hardwareBrightnessOnUnsupportedHmd: boolean;
  cctControlOnUnsupportedHmd: boolean;
}

/** The brightness and colour temperature settings of a headset's device page, stored per headset. */
@Component({
  selector: 'app-hmd-display-settings',
  templateUrl: './hmd-display-settings.component.html',
  standalone: false,
  // the host is the category, so the global sibling margin between categories applies to it
  host: { style: 'display: block', '[class.setting-category]': 'visible()' },
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
  protected readonly values = computed(() => this.resolve(this.settings()));
  protected readonly maxBrightnessRange = computed((): [number, number] | null => {
    switch (this.model()) {
      case 'VALVE_INDEX':
        return [INDEX_BOUNDS.overdriveThreshold, INDEX_BOUNDS.riskThreshold];
      case 'BIGSCREEN_BEYOND':
        return [
          BEYOND_BOUNDS.overdriveThreshold,
          this.values().unsafeBrightness
            ? BEYOND_BOUNDS.hardwareStops[BEYOND_BOUNDS.hardwareStops.length - 1]
            : BEYOND_BOUNDS.riskThreshold,
        ];
      case 'STEAM_FRAME':
        return [FRAME_BOUNDS.overdriveThreshold, FRAME_BOUNDS.riskThreshold];
      default:
        return null;
    }
  });
  protected readonly maxBrightnessDefault = computed(() => {
    const key = GLOBAL_MAX_BRIGHTNESS[this.model()];
    return key ? APP_SETTINGS_DEFAULT[key] : null;
  });
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
      (!!this.maxBrightnessRange() || this.brightnessFallback() || this.cctFallback())
  );

  /** Matches the headset drivers' own model checks, from the identity stored for the device. */
  private modelOf(device: DMKnownDevice): HmdModel {
    if (this.steamFrame.identityOf(device)) return 'STEAM_FRAME';
    if (device.manufacturer === 'Valve' && device.typeName === 'Index') return 'VALVE_INDEX';
    if (device.manufacturer === 'Bigscreen') return 'BIGSCREEN_BEYOND';
    if (device.manufacturer === 'SIE' && device.typeName === 'PS VR2') return 'PSVR2';
    return 'OTHER';
  }

  private resolve(settings: AppSettings): Resolved {
    const own = settings.hmdSettings[this.device().id] ?? {};
    const maxKey = GLOBAL_MAX_BRIGHTNESS[this.model()];
    return {
      maxBrightness: maxKey ? (own.maxBrightness ?? settings[maxKey]) : null,
      unsafeBrightness: own.unsafeBrightness ?? settings.bigscreenBeyondUnsafeBrightness,
      hardwareBrightnessOnUnsupportedHmd:
        own.hardwareBrightnessOnUnsupportedHmd ?? settings.hardwareBrightnessOnUnsupportedHmds,
      cctControlOnUnsupportedHmd:
        own.cctControlOnUnsupportedHmd ?? settings.cctControlOnUnsupportedHmds,
    };
  }

  private update(values: HmdSettings) {
    const all = this.settings().hmdSettings;
    const id = this.device().id;
    this.appSettingsService.updateSettings({
      hmdSettings: { ...all, [id]: { ...all[id], ...values } },
    });
  }

  setMaxBrightness(value: number) {
    const range = this.maxBrightnessRange();
    if (!range) return;
    this.update({ maxBrightness: Math.min(Math.max(value, range[0]), range[1]) });
  }

  toggleBeyondSafeBrightness() {
    const unsafe = !this.values().unsafeBrightness;
    const max = this.values().maxBrightness ?? BEYOND_BOUNDS.riskThreshold;
    this.update({
      unsafeBrightness: unsafe,
      maxBrightness: unsafe ? max : Math.min(max, BEYOND_BOUNDS.riskThreshold),
    });
  }

  toggleBrightnessFallback() {
    this.update({
      hardwareBrightnessOnUnsupportedHmd: !this.values().hardwareBrightnessOnUnsupportedHmd,
    });
  }

  toggleCctFallback() {
    this.update({ cctControlOnUnsupportedHmd: !this.values().cctControlOnUnsupportedHmd });
  }
}
