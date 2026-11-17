import { isEmpty, pickBy } from 'lodash';
import { DEVICE_MANAGER_DATA_DEFAULT } from '../models/device-manager';
import type { MigrationDefinition, Versioned } from 'src-shared-ts/src/migration-runner';
import { migrateKnownLighthouseDeviceId } from './lighthouse-device-id';
import { normalizeWithDefaults } from './migration-defaults';

function from1to2(data: any): any {
  data.version = 2;
  const knownDevices: any[] = [];
  for (const device of data.knownDevices ?? []) {
    device.id = migrateKnownLighthouseDeviceId(device.id) ?? device.id;
    // Both id formats can be present for one device, each with its own entry
    const existing = knownDevices.find((d) => d.id === device.id);
    if (!existing) {
      knownDevices.push(device);
      continue;
    }
    existing.nickname = existing.nickname ?? device.nickname;
    existing.tagIds = [...new Set([...(existing.tagIds ?? []), ...(device.tagIds ?? [])])];
    existing.disabled = existing.disabled || device.disabled;
    existing.lastSeen = Math.max(existing.lastSeen ?? 0, device.lastSeen ?? 0);
  }
  data.knownDevices = knownDevices;
  return data;
}

/** The manufacturer of each headset model stored before the device manager recorded manufacturers. */
const LEGACY_HMD_MANUFACTURERS: Readonly<Record<string, string>> = {
  Index: 'Valve',
  Beyond: 'Bigscreen',
  'Steam Frame': 'Valve',
  'Deckard DV2': 'Valve',
  'Deckard MP': 'Valve',
  'PS VR2': 'SIE',
};

function from2to3(data: any, store: Readonly<Record<string, any>>): any {
  data.version = 3;

  // take each global headset value the user changed from the app settings as read
  const appSettings = store['APP_SETTINGS'] ?? {};
  const changed = (key: string, defaultValue: unknown) =>
    appSettings[key] === defaultValue ? undefined : appSettings[key];
  const valuesByModel = {
    VALVE_INDEX: { maxBrightness: changed('valveIndexMaxBrightness', 160) },
    BIGSCREEN_BEYOND: {
      maxBrightness: changed('bigscreenBeyondMaxBrightness', 150),
      unsafeBrightness: changed('bigscreenBeyondUnsafeBrightness', false),
    },
    OTHER_HMD: {
      hardwareBrightnessOnUnsupportedHmd: changed('hardwareBrightnessOnUnsupportedHmds', false),
      cctControlOnUnsupportedHmd: changed('cctControlOnUnsupportedHmds', false),
    },
  };

  for (const device of data.knownDevices ?? []) {
    if (device.deviceType !== 'HMD') continue;

    // fill in the manufacturer of a headset stored before manufacturers were
    const legacyManufacturer = LEGACY_HMD_MANUFACTURERS[device.typeName];
    if (!device.manufacturer && legacyManufacturer) device.manufacturer = legacyManufacturer;

    // give the headset the changed values of its model
    const model = settingsModel(device);
    if (!model) continue;
    const values = pickBy(valuesByModel[model], (value) => value !== undefined);
    if (!isEmpty(values)) device.settings = { model, ...values };
  }
  return data;
}

/** The model a headset has settings for; null for a model without any. */
function settingsModel(hmd: any): 'VALVE_INDEX' | 'BIGSCREEN_BEYOND' | 'OTHER_HMD' | null {
  const { manufacturer, typeName } = hmd;
  if (manufacturer === 'Valve' && typeName === 'Index') return 'VALVE_INDEX';
  if (manufacturer === 'Bigscreen') return 'BIGSCREEN_BEYOND';
  // a Frame or a PS VR2 has its own brightness driver and no colour fallback
  const isFrame =
    manufacturer === 'Valve' && ['Steam Frame', 'Deckard DV2', 'Deckard MP'].includes(typeName);
  if (isFrame || (manufacturer === 'SIE' && typeName === 'PS VR2')) return null;
  return 'OTHER_HMD';
}

export const DEVICE_MANAGER_MIGRATION: MigrationDefinition<Versioned> = {
  targetVersion: DEVICE_MANAGER_DATA_DEFAULT.version,
  minimumSupportedVersion: 1,
  steps: {
    1: from1to2,
    2: from2to3,
  },
  normalizeCurrentVersion: (data) => normalizeWithDefaults(DEVICE_MANAGER_DATA_DEFAULT, data),
};
