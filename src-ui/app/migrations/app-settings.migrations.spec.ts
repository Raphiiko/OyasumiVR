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
      { version: 15, vrcxLogsEnabled: ['SleepMode'] } as Versioned,
      APP_SETTINGS_MIGRATION
    );

    expect(result.status).toBe('migrated');
    if (result.status === 'migrated') {
      expect(result.value).toMatchObject({
        vrcxLogsEnabled: ['SleepMode', 'Invites', 'StatusChanges', 'GroupChanges'],
      });
    }
  });
});

describe('app settings migration 16 to 17', () => {
  it('drops the CCT enable setting and warning flag, and keeps the other flags', async () => {
    const result = await runMigrations(
      {
        version: 16,
        cctControlEnabled: false,
        oneTimeFlags: [
          'CCT_CONTROL_WARNING_DIALOG',
          'OSC_SCRIPT_SIMPLE_EDITOR_VRCHAT_AUTOCOMPLETE_INFO',
        ],
      } as Versioned,
      APP_SETTINGS_MIGRATION
    );

    expect(result.status).toBe('migrated');
    if (result.status === 'migrated') {
      expect(result.value).toMatchObject({
        version: 17,
        oneTimeFlags: ['OSC_SCRIPT_SIMPLE_EDITOR_VRCHAT_AUTOCOMPLETE_INFO'],
        cctControlOnUnsupportedHmds: false,
      });
      expect(result.value).not.toHaveProperty('cctControlEnabled');
    }
  });
});
