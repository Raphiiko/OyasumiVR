import { TELEMETRY_SETTINGS_DEFAULT } from '../models/telemetry-settings';
import type { MigrationDefinition, Versioned } from 'src-shared-ts/src/migration-runner';
import { normalizeWithDefaults } from './migration-defaults';

function from1to2(data: any): any {
  return {
    enabled: data.enabled,
    version: 2,
  };
}

export const TELEMETRY_SETTINGS_MIGRATION: MigrationDefinition<Versioned> = {
  targetVersion: TELEMETRY_SETTINGS_DEFAULT.version,
  minimumSupportedVersion: 1,
  steps: {
    1: from1to2,
  },
  normalizeCurrentVersion: (data) => normalizeWithDefaults(TELEMETRY_SETTINGS_DEFAULT, data),
};
