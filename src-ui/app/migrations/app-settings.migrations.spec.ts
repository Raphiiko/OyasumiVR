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
      expect(result.value).toMatchObject({ quitWithSteamVR: expected });
    }
  });
});

describe('app settings migration 15 to 16', () => {
  it('turns on the social VRCX logs and keeps the existing choice', async () => {
    const result = await runMigrations(
      { version: 15, vrcxLogsEnabled: [] } as Versioned,
      APP_SETTINGS_MIGRATION
    );

    expect(result.status).toBe('migrated');
    if (result.status === 'migrated') {
      expect(result.value).toMatchObject({
        version: 16,
        vrcxLogsEnabled: ['Invites', 'StatusChanges', 'GroupChanges'],
      });
    }
  });
});
