export interface DeviceSelection {
  devices: string[];
  types: DMDeviceType[];
  tagIds: string[];
}

export interface DeviceManagerData {
  version: 3;
  knownDevices: DMKnownDevice[];
  tags: DMDeviceTag[];
}

export const DMDeviceTypes = ['HMD', 'TRACKER', 'CONTROLLER', 'LIGHTHOUSE'] as const;
export type DMDeviceType = (typeof DMDeviceTypes)[number];

/**
 * A known device's own settings, for the model the app detects it as. A missing value uses the
 * model's default.
 */
export type DMDeviceSettings =
  | { model: 'VALVE_INDEX'; maxBrightness?: number }
  | { model: 'BIGSCREEN_BEYOND'; maxBrightness?: number }
  | { model: 'STEAM_FRAME'; maxBrightness?: number }
  | {
      /** A headset without a dedicated brightness driver, and not on the SteamVR colour gain list. */
      model: 'OTHER_HMD';
      hardwareBrightnessOnUnsupportedHmd?: boolean;
      cctControlOnUnsupportedHmd?: boolean;
    };

export type DMDeviceSettingsModel = DMDeviceSettings['model'];

export interface DMKnownDevice {
  id: string;
  typeName: string;
  /** OpenVR manufacturer, recorded for OpenVR devices once they are seen. */
  manufacturer?: string;
  defaultName: string;
  nickname?: string;
  deviceType: DMDeviceType;
  lastSeen: number;
  tagIds: string[];
  disabled: boolean;
  settings?: DMDeviceSettings;
}

export interface DMDeviceTag {
  id: string;
  name: string;
  color: string;
}

export const DEVICE_MANAGER_DATA_DEFAULT: DeviceManagerData = {
  version: 3,
  knownDevices: [],
  tags: [],
};

export const DEVICE_MANAGER_TAG_COLORS = [
  '#F44336', // Red 500
  '#E91E63', // Pink 500
  '#9C27B0', // Purple 500
  '#673AB7', // Deep Purple 500
  '#3F51B5', // Indigo 500
  '#2196F3', // Blue 500
  '#00BCD4', // Cyan 500
  '#4CAF50', // Green 500
  '#FF9800', // Orange 500
  '#795548', // Brown 500
] as const;
