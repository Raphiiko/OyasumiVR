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
export const LEGACY_HMD_MANUFACTURERS: Readonly<Record<string, string>> = {
  Index: 'Valve',
  Beyond: 'Bigscreen',
  'Steam Frame': 'Valve',
  'Deckard DV2': 'Valve',
  'Deckard MP': 'Valve',
  'PS VR2': 'SIE',
};

function from2to3(data: any): any {
  data.version = 3;
  for (const device of data.knownDevices ?? []) {
    if (device.deviceType !== 'HMD' || device.manufacturer) continue;
    const manufacturer = LEGACY_HMD_MANUFACTURERS[device.typeName];
    if (manufacturer) device.manufacturer = manufacturer;
  }
  return data;
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
