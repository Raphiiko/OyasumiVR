import { PULSOID_API_SETTINGS_DEFAULT } from '../models/pulsoid-api-settings';
import type { MigrationDefinition, Versioned } from 'src-shared-ts/src/migration-runner';
import { protectSecret } from '../utils/secrets';
import { normalizeWithDefaults } from './migration-defaults';

async function from1to2(data: any): Promise<any> {
  data.accessToken = (await protectSecret(data.accessToken)) ?? undefined;
  data.version = 2;
  return data;
}

export const PULSOID_API_MIGRATION: MigrationDefinition<Versioned> = {
  targetVersion: PULSOID_API_SETTINGS_DEFAULT.version,
  minimumSupportedVersion: 1,
  steps: {
    1: from1to2,
  },
  normalizeCurrentVersion: (data) => normalizeWithDefaults(PULSOID_API_SETTINGS_DEFAULT, data),
};
