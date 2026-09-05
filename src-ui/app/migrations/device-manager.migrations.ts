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

export const DEVICE_MANAGER_MIGRATION: MigrationDefinition<Versioned> = {
  targetVersion: DEVICE_MANAGER_DATA_DEFAULT.version,
  minimumSupportedVersion: 1,
  steps: {
    1: from1to2,
  },
  normalizeCurrentVersion: (data) => normalizeWithDefaults(DEVICE_MANAGER_DATA_DEFAULT, data),
};
