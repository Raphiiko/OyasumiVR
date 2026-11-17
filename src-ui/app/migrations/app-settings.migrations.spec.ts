import { describe, expect, it } from 'vitest';
import { runMigrations, Versioned } from 'src-shared-ts/src/migration-runner';
import { decideStoreMigration } from 'src-shared-ts/src/store-migration';
import { APP_SETTINGS_MIGRATION } from './app-settings.migrations';
import { SETTINGS_STORE_MIGRATION } from './store-migrations';

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
  it('drops the CCT enable setting and warning flag', async () => {
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
        oneTimeFlags: ['OSC_SCRIPT_SIMPLE_EDITOR_VRCHAT_AUTOCOMPLETE_INFO'],
      });
      expect(result.value).not.toHaveProperty('cctControlEnabled');
    }
  });
});

describe('app settings migration 17 to 18', () => {
  it.each([
    [
      ['SLEEP_MODE_ENABLED', 'AUTO_ACCEPTED_INVITE_REQUEST'],
      ['SLEEP_MODE_ENABLED', 'INVITE_AUTOMATIONS'],
    ],
    [['SLEEP_MODE_ENABLED'], ['SLEEP_MODE_ENABLED']],
  ])(
    'carries the accepted invite request choice over to invite notifications',
    async (types, expected) => {
      const result = await runMigrations(
        { version: 17, notificationsEnabled: { types } } as Versioned,
        APP_SETTINGS_MIGRATION
      );

      expect(result.status).toBe('migrated');
      if (result.status === 'migrated') {
        expect(result.value.notificationsEnabled).toEqual({ types: expected });
      }
    }
  );
});

describe('app settings migration 18 to 19', () => {
  it('moves the unsafe fan speed setting out of the fan automation config', async () => {
    const store = {
      APP_SETTINGS: { version: 18 },
      AUTOMATION_CONFIGS: {
        version: 22,
        BIGSCREEN_BEYOND_FAN_CONTROL: { enabled: true, allowUnsafeFanSpeed: true },
      },
    };

    const decision = await decideStoreMigration(
      [{ id: 'live', kind: 'live', contents: JSON.stringify(store) }],
      SETTINGS_STORE_MIGRATION
    );

    expect(decision.action).toBe('install');
    if (decision.action !== 'install') return;
    const { APP_SETTINGS, AUTOMATION_CONFIGS } = JSON.parse(decision.contents);
    expect(APP_SETTINGS.bigscreenBeyondAllowUnsafeFanSpeed).toBe(true);
    expect(AUTOMATION_CONFIGS.version).toBe(23);
    expect(AUTOMATION_CONFIGS.BIGSCREEN_BEYOND_FAN_CONTROL).not.toHaveProperty(
      'allowUnsafeFanSpeed'
    );
  });
});
