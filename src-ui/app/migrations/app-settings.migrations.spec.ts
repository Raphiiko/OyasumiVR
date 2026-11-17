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
  const hmd = (id: string, typeName: string, manufacturer?: string) => ({
    id: `OVR_HMD_${id}`,
    typeName,
    manufacturer,
    deviceType: 'HMD',
  });

  it('gives each known headset the changed global values of its model, and a Frame or PS VR2 none', async () => {
    const store = {
      APP_SETTINGS: {
        version: 18,
        valveIndexMaxBrightness: 130,
        bigscreenBeyondMaxBrightness: 150,
        bigscreenBeyondUnsafeBrightness: true,
        hardwareBrightnessOnUnsupportedHmds: false,
        cctControlOnUnsupportedHmds: true,
      },
      DEVICE_MANAGER: {
        version: 2,
        tags: [],
        knownDevices: [
          hmd('LHR-TEST0001', 'Index', 'Valve'),
          hmd('BSB-TEST0002', 'Beyond'),
          hmd('FRM-TEST0003', 'Steam Frame', 'Valve'),
          hmd('OTH-TEST0004', 'Visor X', 'Other'),
          // headsets stored before the device manager recorded manufacturers
          hmd('LHR-TEST0006', 'Index'),
          hmd('FRM-TEST0007', 'Deckard MP'),
          hmd('PSV-TEST0008', 'PS VR2'),
          { id: 'OVR_CONTROLLER_LHR-TEST0005', typeName: 'Knuckles', deviceType: 'CONTROLLER' },
        ],
      },
    };

    const decision = await decideStoreMigration(
      [{ id: 'live', kind: 'live', contents: JSON.stringify(store) }],
      SETTINGS_STORE_MIGRATION
    );

    expect(decision.action).toBe('install');
    if (decision.action !== 'install') return;
    const settings = JSON.parse(decision.contents).APP_SETTINGS;
    expect(settings.version).toBe(19);
    expect(settings.hmdSettings).toEqual({
      'OVR_HMD_LHR-TEST0001': { model: 'VALVE_INDEX', maxBrightness: 130 },
      'OVR_HMD_BSB-TEST0002': { model: 'BIGSCREEN_BEYOND', unsafeBrightness: true },
      'OVR_HMD_OTH-TEST0004': { model: 'OTHER', cctControlOnUnsupportedHmd: true },
      'OVR_HMD_LHR-TEST0006': { model: 'VALVE_INDEX', maxBrightness: 130 },
    });
    for (const key of [
      'valveIndexMaxBrightness',
      'bigscreenBeyondMaxBrightness',
      'bigscreenBeyondUnsafeBrightness',
      'hardwareBrightnessOnUnsupportedHmds',
      'cctControlOnUnsupportedHmds',
    ]) {
      expect(settings).not.toHaveProperty(key);
    }
  });

  it('gives no headset a value when every global value is its default', async () => {
    const result = await runMigrations(
      {
        version: 18,
        valveIndexMaxBrightness: 160,
        bigscreenBeyondMaxBrightness: 150,
        bigscreenBeyondUnsafeBrightness: false,
        hardwareBrightnessOnUnsupportedHmds: false,
        cctControlOnUnsupportedHmds: false,
      } as Versioned,
      APP_SETTINGS_MIGRATION,
      { DEVICE_MANAGER: { knownDevices: [hmd('LHR-TEST0001', 'Index', 'Valve')] } }
    );

    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') return;
    expect((result.value as any).hmdSettings).toEqual({});
  });
});
