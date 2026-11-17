import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DMKnownDevice } from 'src-ui/app/models/device-manager';
import { AppSettings, HmdSettings, HmdSettingsModel } from 'src-ui/app/models/settings';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { SteamFrameService } from 'src-ui/app/services/steam-frame/steam-frame.service';
import { ownHmdSettings } from 'src-ui/app/utils/hmd-settings-utils';
import { VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS as INDEX_BOUNDS } from 'src-ui/app/services/brightness-control/hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS as BEYOND_BOUNDS } from 'src-ui/app/services/brightness-control/hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';

/** A Frame or a PS VR2 has its own driver and no settings here. */
type HmdModel = HmdSettingsModel | 'STEAM_FRAME' | 'PSVR2';
/** The values a model stores for a headset. */
type ModelValues<M extends HmdSettingsModel> = Omit<Extract<HmdSettings, { model: M }>, 'model'>;

/** The maximum brightness of a headset without its own, as its driver uses it. */
const DEFAULT_MAX_BRIGHTNESS: Partial<Record<HmdModel, number>> = {
  VALVE_INDEX: INDEX_BOUNDS.riskThreshold,
  BIGSCREEN_BEYOND: BEYOND_BOUNDS.riskThreshold,
};

/** The values this page shows, each one falling back to its default. */
interface ShownValues {
  /** Valve Index and Bigscreen Beyond; null for a model without a maximum. */
  maxBrightness: number | null;
  /** Bigscreen Beyond only: allows a maximum above 150%. */
  beyondUnsafeBrightness: boolean;
  /** Headsets without a dedicated driver only: tries SteamVR's analog gain. */
  otherHmdTryHardwareBrightness: boolean;
  /** Headsets without a dedicated driver only: tries SteamVR's colour gain. */
  otherHmdTryCctControl: boolean;
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
          this.values().beyondUnsafeBrightness
            ? BEYOND_BOUNDS.hardwareStops[BEYOND_BOUNDS.hardwareStops.length - 1]
            : BEYOND_BOUNDS.riskThreshold,
        ];
      default:
        return null;
    }
  });
  protected readonly maxBrightnessDefault = computed(
    () => DEFAULT_MAX_BRIGHTNESS[this.model()] ?? null
  );
  /**
   * True for a headset with no brightness driver and no SteamVR colour gains. Every model on
   * STEAMVR_CCT_SUPPORTED_HMDS has a model of its own, so 'OTHER' is never on that list.
   */
  protected readonly fallbacks = computed(() => this.model() === 'OTHER');
  protected readonly visible = computed(
    () => this.device().deviceType === 'HMD' && (!!this.maxBrightnessRange() || this.fallbacks())
  );

  /** Matches the headset drivers' own model checks, from the identity stored for the device. */
  private modelOf(device: DMKnownDevice): HmdModel {
    if (this.steamFrame.identityOf(device)) return 'STEAM_FRAME';
    if (device.manufacturer === 'Valve' && device.typeName === 'Index') return 'VALVE_INDEX';
    if (device.manufacturer === 'Bigscreen') return 'BIGSCREEN_BEYOND';
    if (device.manufacturer === 'SIE' && device.typeName === 'PS VR2') return 'PSVR2';
    return 'OTHER';
  }

  private resolve(settings: AppSettings): ShownValues {
    const model = this.model();
    // an entry counts only for the model this headset is detected as
    const own = <M extends HmdSettingsModel>(m: M) =>
      model === m ? ownHmdSettings(settings, this.device().id, m) : undefined;
    const defaultMax = DEFAULT_MAX_BRIGHTNESS[model];
    const ownMax = (own('VALVE_INDEX') ?? own('BIGSCREEN_BEYOND'))?.maxBrightness;
    return {
      maxBrightness: defaultMax === undefined ? null : (ownMax ?? defaultMax),
      beyondUnsafeBrightness: !!own('BIGSCREEN_BEYOND')?.unsafeBrightness,
      otherHmdTryHardwareBrightness: !!own('OTHER')?.hardwareBrightnessOnUnsupportedHmd,
      otherHmdTryCctControl: !!own('OTHER')?.cctControlOnUnsupportedHmd,
    };
  }

  /** Stores values of this headset's model; an entry of another model is replaced. */
  private update<M extends HmdSettingsModel>(model: M, values: ModelValues<M>) {
    if (this.model() !== model) return;
    const id = this.device().id;
    const stored = this.settings().hmdSettings[id];
    const entry = { ...(stored?.model === model ? stored : {}), ...values, model } as HmdSettings;
    this.appSettingsService.updateSettings({
      hmdSettings: { ...this.settings().hmdSettings, [id]: entry },
    });
  }

  setMaxBrightness(value: number) {
    const model = this.model();
    const range = this.maxBrightnessRange();
    if (!range || (model !== 'VALVE_INDEX' && model !== 'BIGSCREEN_BEYOND')) return;
    this.update(model, { maxBrightness: Math.min(Math.max(value, range[0]), range[1]) });
  }

  toggleBeyondSafeBrightness() {
    const unsafe = !this.values().beyondUnsafeBrightness;
    const max = this.values().maxBrightness ?? BEYOND_BOUNDS.riskThreshold;
    this.update('BIGSCREEN_BEYOND', {
      unsafeBrightness: unsafe,
      maxBrightness: unsafe ? max : Math.min(max, BEYOND_BOUNDS.riskThreshold),
    });
  }

  toggleBrightnessFallback() {
    this.update('OTHER', {
      hardwareBrightnessOnUnsupportedHmd: !this.values().otherHmdTryHardwareBrightness,
    });
  }

  toggleCctFallback() {
    this.update('OTHER', { cctControlOnUnsupportedHmd: !this.values().otherHmdTryCctControl });
  }
}
