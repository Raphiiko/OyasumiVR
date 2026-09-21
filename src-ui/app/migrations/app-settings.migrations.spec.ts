import { describe, expect, it } from 'vitest';
import { runMigrations, Versioned } from 'src-shared-ts/src/migration-runner';
import { APP_SETTINGS_MIGRATION } from './app-settings.migrations';

describe('app settings migration 14 to 15', () => {
  it.each([
    ['DISABLED', false],
    ['IMMEDIATELY', true],
    ['AFTERDELAY', true],
  ])('maps %s to %s', async (oldValue, expected) => {
    const result = await runMigrations(
      { version: 14, quitWithSteamVR: oldValue } as Versioned,
      APP_SETTINGS_MIGRATION
    );

    expect(result.status).toBe('migrated');
    if (result.status === 'migrated') {
      expect(result.value).toMatchObject({ version: 15, quitWithSteamVR: expected });
    }
  });
});
