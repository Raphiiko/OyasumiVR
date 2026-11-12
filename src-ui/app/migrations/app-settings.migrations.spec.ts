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
  it('moves the changed global headset values out of the settings', async () => {
    const result = await runMigrations(
      {
        version: 18,
        valveIndexMaxBrightness: 130,
        bigscreenBeyondMaxBrightness: 150,
        bigscreenBeyondUnsafeBrightness: true,
        hardwareBrightnessOnUnsupportedHmds: false,
        cctControlOnUnsupportedHmds: true,
      } as Versioned,
      APP_SETTINGS_MIGRATION
    );

    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') return;
    expect(result.value).toMatchObject({
      version: 19,
      legacyHmdSettings: {
        valveIndex: { maxBrightness: 130 },
        bigscreenBeyond: { unsafeBrightness: true },
        allHmds: { cctControlOnUnsupportedHmd: true },
      },
    });
    for (const key of [
      'valveIndexMaxBrightness',
      'bigscreenBeyondMaxBrightness',
      'bigscreenBeyondUnsafeBrightness',
      'hardwareBrightnessOnUnsupportedHmds',
      'cctControlOnUnsupportedHmds',
    ]) {
      expect(result.value).not.toHaveProperty(key);
    }
  });

  it('leaves nothing to copy when every headset value is its default', async () => {
    const result = await runMigrations(
      {
        version: 18,
        valveIndexMaxBrightness: 160,
        bigscreenBeyondMaxBrightness: 150,
        bigscreenBeyondUnsafeBrightness: false,
        hardwareBrightnessOnUnsupportedHmds: false,
        cctControlOnUnsupportedHmds: false,
      } as Versioned,
      APP_SETTINGS_MIGRATION
    );

    expect(result.status === 'migrated' && result.value).toMatchObject({
      legacyHmdSettings: null,
      hmdSettings: {},
    });
  });
});
