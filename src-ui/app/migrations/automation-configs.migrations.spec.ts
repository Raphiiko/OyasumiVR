import { describe, expect, it } from 'vitest';
import { migrateAutomationConfigs } from './automation-configs.migrations';
import { fakeTauri } from '../../testing/fake-tauri';
import {
  corruptLegacyValue,
  createLegacyKey,
  legacyEncrypt,
} from '../../testing/legacy-storage-crypto';

function store(runAutomations: Record<string, unknown> | undefined) {
  return {
    version: 19,
    ...(runAutomations ? { RUN_AUTOMATIONS: { enabled: true, ...runAutomations } } : {}),
    SLEEP_MODE_ENABLE_AT_TIME: { enabled: false, time: '03:33' },
  };
}

describe('migrateAutomationConfigs, version 19 to 20', () => {
  it('decrypts the commands and drops the key', async () => {
    const { key, serialized } = await createLegacyKey();
    const migrated = await migrateAutomationConfigs(
      store({
        runAutomationsCryptoKey: serialized,
        onSleepModeEnableCommands: await legacyEncrypt(key, 'echo enable'),
        onSleepModeDisableCommands: await legacyEncrypt(key, 'echo disable & echo "quoted %VAR%"'),
        onSleepPreparationCommands: await legacyEncrypt(key, 'echo prepare'),
      })
    );

    expect(migrated.version).toBe(20);
    expect(migrated.RUN_AUTOMATIONS.onSleepModeEnableCommands).toBe('echo enable');
    expect(migrated.RUN_AUTOMATIONS.onSleepModeDisableCommands).toBe(
      'echo disable & echo "quoted %VAR%"'
    );
    expect(migrated.RUN_AUTOMATIONS.onSleepPreparationCommands).toBe('echo prepare');
    expect(migrated.RUN_AUTOMATIONS).not.toHaveProperty('runAutomationsCryptoKey');
    expect(migrated.SLEEP_MODE_ENABLE_AT_TIME.time).toBe('03:33');
    expect(fakeTauri.dialogs).toHaveLength(0);
  });

  it('empties an encrypted command when the key is missing', async () => {
    const { key } = await createLegacyKey();
    const migrated = await migrateAutomationConfigs(
      store({ onSleepModeEnableCommands: await legacyEncrypt(key, 'echo enable') })
    );

    expect(migrated.RUN_AUTOMATIONS.onSleepModeEnableCommands).toBe('');
    expect(migrated.SLEEP_MODE_ENABLE_AT_TIME.time).toBe('03:33');
    expect(fakeTauri.dialogs).toHaveLength(0);
  });

  it('empties every command when the key cannot be read', async () => {
    const { key } = await createLegacyKey();
    const migrated = await migrateAutomationConfigs(
      store({
        runAutomationsCryptoKey: 'garbage$key',
        onSleepModeEnableCommands: await legacyEncrypt(key, 'echo enable'),
        onSleepPreparationCommands: await legacyEncrypt(key, 'echo prepare'),
      })
    );

    expect(migrated.RUN_AUTOMATIONS.onSleepModeEnableCommands).toBe('');
    expect(migrated.RUN_AUTOMATIONS.onSleepPreparationCommands).toBe('');
    expect(fakeTauri.logsMatching("Couldn't read the Run Automations command key")).toHaveLength(1);
  });

  it('empties only the command it cannot decrypt', async () => {
    const { key, serialized } = await createLegacyKey();
    const migrated = await migrateAutomationConfigs(
      store({
        runAutomationsCryptoKey: serialized,
        onSleepModeEnableCommands: corruptLegacyValue(),
        onSleepModeDisableCommands: await legacyEncrypt(key, 'echo disable'),
      })
    );

    expect(migrated.RUN_AUTOMATIONS.onSleepModeEnableCommands).toBe('');
    expect(migrated.RUN_AUTOMATIONS.onSleepModeDisableCommands).toBe('echo disable');
    expect(fakeTauri.dialogs).toHaveLength(0);
  });

  it('empties a command that is not encrypted, so an unverified one never runs', async () => {
    const { serialized } = await createLegacyKey();
    const migrated = await migrateAutomationConfigs(
      store({
        runAutomationsCryptoKey: serialized,
        onSleepModeEnableCommands: 'echo planted by another process',
      })
    );

    expect(migrated.RUN_AUTOMATIONS.onSleepModeEnableCommands).toBe('');
  });

  it('survives a store with no Run Automations config', async () => {
    const migrated = await migrateAutomationConfigs(store(undefined));

    expect(migrated.version).toBe(20);
    expect(migrated.RUN_AUTOMATIONS.onSleepModeEnableCommands).toBe('');
    expect(fakeTauri.dialogs).toHaveLength(0);
  });
});
