import { describe, expect, it } from 'vitest';
import { runMigrations, Versioned } from 'src-shared-ts/src/migration-runner';
import { APP_SETTINGS_MIGRATION } from './app-settings.migrations';
import { SETTINGS_STORE_MIGRATION } from './store-migrations';
import { decideStoreMigration } from 'src-shared-ts/src/store-migration';
import { APP_SETTINGS_DEFAULT } from '../models/settings';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';

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

describe('settings store migration of CCT automations', () => {
  const store = (cctControlEnabled: boolean, version = 16) => ({
    id: 'live',
    kind: 'live' as const,
    contents: JSON.stringify({
      APP_SETTINGS: { ...structuredClone(APP_SETTINGS_DEFAULT), version, cctControlEnabled },
      AUTOMATION_CONFIGS: structuredClone(AUTOMATION_CONFIGS_DEFAULT),
    }),
  });
  const cctFlags = (contents: string) =>
    Object.values(JSON.parse(contents).AUTOMATION_CONFIGS.BRIGHTNESS_AUTOMATIONS)
      .filter((c): c is { changeColorTemperature: boolean } => typeof c === 'object')
      .map((c) => c.changeColorTemperature);

  it('turns off CCT in brightness automations when color temperature control was off', async () => {
    const decision = await decideStoreMigration([store(false)], SETTINGS_STORE_MIGRATION);
    expect(decision.action).toBe('install');
    if (decision.action !== 'install') return;
    expect(cctFlags(decision.contents)).toEqual([false, false, false, false, false, false]);
  });

  it.each([
    ['color temperature control was on', store(true)],
    ['the settings already migrated', store(false, 17)],
  ])('keeps CCT in brightness automations when %s', async (_, candidate) => {
    const decision = await decideStoreMigration([candidate], SETTINGS_STORE_MIGRATION);
    const contents = decision.action === 'install' ? decision.contents : candidate.contents;
    expect(cctFlags(contents)).toEqual([true, true, true, true, true, true]);
  });
});
