import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  DMDeviceSettings,
  DMDeviceSettingsModel,
  DMKnownDevice,
} from 'src-ui/app/models/device-manager';
import { AppSettings } from 'src-ui/app/models/settings';
import { DeviceManagerService } from 'src-ui/app/services/device-manager.service';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { SteamFrameService } from 'src-ui/app/services/steam-frame/steam-frame.service';
import { ownDeviceSettings } from 'src-ui/app/utils/device-settings-utils';
import { clamp } from 'src-ui/app/utils/number-utils';
import { VALVE_INDEX_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS as INDEX_BOUNDS } from 'src-ui/app/services/brightness-control/hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { BIGSCREEN_BEYOND_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS as BEYOND_BOUNDS } from 'src-ui/app/services/brightness-control/hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';

/** A Frame or a PS VR2 has its own driver and no settings here. */
type HmdModel = DMDeviceSettingsModel | 'STEAM_FRAME' | 'PSVR2';
/** The values a model stores for a device. */
type ModelValues<M extends DMDeviceSettingsModel> = Omit<
  Extract<DMDeviceSettings, { model: M }>,
  'model'
>;
/** The models whose settings hold the field `K`. */
type ModelsWith<K extends string> = DMDeviceSettings extends infer S
  ? S extends DMDeviceSettings
    ? K extends keyof S
      ? S['model']
      : never
    : never
  : never;
type MaxBrightnessModel = ModelsWith<'maxBrightness'>;

/**
 * The maximum brightness slider of every model that stores a maximum, as its driver applies it.
 * The default is the maximum of a headset without its own.
 */
const MAX_BRIGHTNESS: Record<
  MaxBrightnessModel,
  { default: number; range: (settings: AppSettings) => [number, number] }
> = {
  VALVE_INDEX: {
    default: INDEX_BOUNDS.riskThreshold,
    range: () => [INDEX_BOUNDS.overdriveThreshold, INDEX_BOUNDS.riskThreshold],
  },
  BIGSCREEN_BEYOND: {
    default: BEYOND_BOUNDS.riskThreshold,
    range: (settings) => [
      BEYOND_BOUNDS.overdriveThreshold,
      settings.bigscreenBeyondUnsafeBrightness
        ? BEYOND_BOUNDS.hardwareStops[BEYOND_BOUNDS.hardwareStops.length - 1]
        : BEYOND_BOUNDS.riskThreshold,
    ],
  },
};

function hasMaxBrightness(model: HmdModel): model is MaxBrightnessModel {
  return model in MAX_BRIGHTNESS;
}

/** The values this page shows, each one falling back to its default. */
interface ShownValues {
  /** Every model in MAX_BRIGHTNESS; null for a model without a maximum. */
  maxBrightness: number | null;
  /** Bigscreen Beyond only, a global setting: allows a maximum above 150%. */
  beyondUnsafeBrightness: boolean;
  /** Headsets without a dedicated driver only: tries SteamVR's analog gain. */
  otherHmdTryHardwareBrightness: boolean;
  /** Headsets without a dedicated driver only: tries SteamVR's colour gain. */
  otherHmdTryCctControl: boolean;
}

/** The brightness and colour temperature settings of a headset's device page. */
@Component({
  selector: 'app-hmd-display-settings',
  templateUrl: './hmd-display-settings.component.html',
  standalone: false,
  // the host is the category, so the global sibling margin between categories applies to it
  host: { style: 'display: block', '[class.setting-category]': 'visible()' },
})
export class HmdDisplaySettingsComponent {
  readonly device = input.required<DMKnownDevice>();
  private readonly deviceManager = inject(DeviceManagerService);
  private readonly appSettingsService = inject(AppSettingsService);
  private readonly steamFrame = inject(SteamFrameService);
  private readonly settings = toSignal(this.appSettingsService.settings, {
    initialValue: this.appSettingsService.settingsSync,
  });
  protected readonly model = computed(() => this.modelOf(this.device()));
  protected readonly values = computed(() => this.resolve(this.device(), this.settings()));
  protected readonly maxBrightnessRange = computed(() => {
    const model = this.model();
    return hasMaxBrightness(model) ? MAX_BRIGHTNESS[model].range(this.settings()) : null;
  });
  protected readonly maxBrightnessDefault = computed(() => {
    const model = this.model();
    return hasMaxBrightness(model) ? MAX_BRIGHTNESS[model].default : null;
  });
  /**
   * True for a headset with no brightness driver and no SteamVR colour gains. Every model on
   * STEAMVR_CCT_SUPPORTED_HMDS has a model of its own, so 'OTHER_HMD' is never on that list.
   */
  protected readonly fallbacks = computed(() => this.model() === 'OTHER_HMD');
  protected readonly visible = computed(
    () => this.device().deviceType === 'HMD' && (!!this.maxBrightnessRange() || this.fallbacks())
  );

  /** Matches the headset drivers' own model checks, from the identity stored for the device. */
  private modelOf(device: DMKnownDevice): HmdModel {
    if (this.steamFrame.identityOf(device)) return 'STEAM_FRAME';
    if (device.manufacturer === 'Valve' && device.typeName === 'Index') return 'VALVE_INDEX';
    if (device.manufacturer === 'Bigscreen') return 'BIGSCREEN_BEYOND';
    if (device.manufacturer === 'SIE' && device.typeName === 'PS VR2') return 'PSVR2';
    return 'OTHER_HMD';
  }

  private resolve(device: DMKnownDevice, settings: AppSettings): ShownValues {
    // settings count only for the model this headset is detected as
    const model = this.model();
    let maxBrightness: number | null = null;
    if (hasMaxBrightness(model)) {
      const { default: defaultMax, range } = MAX_BRIGHTNESS[model];
      const ownMax = ownDeviceSettings(device, model)?.maxBrightness ?? defaultMax;
      // a maximum above the range, such as a Beyond's while unsafe brightness is off, applies as the top
      maxBrightness = Math.min(ownMax, range(settings)[1]);
    }
    const fallbacks = model === 'OTHER_HMD' ? ownDeviceSettings(device, model) : undefined;
    return {
      maxBrightness,
      beyondUnsafeBrightness: settings.bigscreenBeyondUnsafeBrightness,
      otherHmdTryHardwareBrightness: !!fallbacks?.hardwareBrightnessOnUnsupportedHmd,
      otherHmdTryCctControl: !!fallbacks?.cctControlOnUnsupportedHmd,
    };
  }

  /** Stores values of this headset's model; settings of another model are replaced. */
  private update<M extends DMDeviceSettingsModel>(model: M, values: ModelValues<M>) {
    const device = this.device();
    const stored = device.settings?.model === model ? device.settings : {};
    const settings = { ...stored, ...values, model } as DMDeviceSettings;
    this.deviceManager.setSettingsForKnownDevice(device, settings);
  }

  setMaxBrightness(value: number) {
    const model = this.model();
    if (!hasMaxBrightness(model)) return;
    const [min, max] = MAX_BRIGHTNESS[model].range(this.settings());
    this.update(model, { maxBrightness: clamp(value, min, max) });
  }

  toggleBeyondSafeBrightness() {
    this.appSettingsService.updateSettings({
      bigscreenBeyondUnsafeBrightness: !this.settings().bigscreenBeyondUnsafeBrightness,
    });
  }

  toggleBrightnessFallback() {
    this.update('OTHER_HMD', {
      hardwareBrightnessOnUnsupportedHmd: !this.values().otherHmdTryHardwareBrightness,
    });
  }

  toggleCctFallback() {
    this.update('OTHER_HMD', { cctControlOnUnsupportedHmd: !this.values().otherHmdTryCctControl });
  }
}
