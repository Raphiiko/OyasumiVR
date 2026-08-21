import { describe, expect, it } from 'vitest';
import { migrateAppSettings } from './app-settings.migrations';
import { migratePulsoidApiSettings } from './pulsoid-api-settings.migrations';
import { fakeTauri } from '../../testing/fake-tauri';

describe('migrateAppSettings, version 11 to 12', () => {
  it('protects the MQTT password and removes the plain one', async () => {
    const migrated = await migrateAppSettings({ version: 11, mqttPassword: 'hunter2' });

    expect(migrated.version).toBe(12);
    expect(migrated.mqttPassword).toBeNull();
    expect(fakeTauri.unprotect(migrated.mqttProtectedPassword!)).toBe('hunter2');
  });

  it('keeps the plain password when protecting fails', async () => {
    fakeTauri.failProtect = true;
    const migrated = await migrateAppSettings({ version: 11, mqttPassword: 'hunter2' });

    expect(migrated.version).toBe(12);
    expect(migrated.mqttPassword).toBe('hunter2');
    expect(migrated.mqttProtectedPassword).toBeNull();
    expect(fakeTauri.logsMatching("Couldn't protect the MQTT password")).toHaveLength(1);
    expect(fakeTauri.dialogs).toHaveLength(0);
  });

  it('does nothing when there is no password', async () => {
    const migrated = await migrateAppSettings({ version: 11, mqttPassword: null });

    expect(migrated.version).toBe(12);
    expect(migrated.mqttPassword).toBeNull();
    expect(migrated.mqttProtectedPassword).toBeNull();
    expect(fakeTauri.protectCalls).toBe(0);
  });
});

describe('migratePulsoidApiSettings, version 1 to 2', () => {
  it('protects the access token and removes the plain one', async () => {
    const migrated = await migratePulsoidApiSettings({
      version: 1,
      accessToken: 'token-abc',
      expiresAt: 4000000000,
      username: 'user',
    });

    expect(migrated.version).toBe(2);
    expect(migrated.accessToken).toBeUndefined();
    expect(fakeTauri.unprotect(migrated.protectedAccessToken!)).toBe('token-abc');
    expect(migrated.expiresAt).toBe(4000000000);
    expect(migrated.username).toBe('user');
  });

  it('keeps the plain token when protecting fails', async () => {
    fakeTauri.failProtect = true;
    const migrated = await migratePulsoidApiSettings({ version: 1, accessToken: 'token-abc' });

    expect(migrated.version).toBe(2);
    expect(migrated.accessToken).toBe('token-abc');
    expect(migrated.protectedAccessToken).toBeUndefined();
    expect(fakeTauri.logsMatching("Couldn't protect the access token")).toHaveLength(1);
    expect(fakeTauri.dialogs).toHaveLength(0);
  });

  it('does nothing when there is no token', async () => {
    const migrated = await migratePulsoidApiSettings({ version: 1 });

    expect(migrated.version).toBe(2);
    expect(migrated.accessToken).toBeUndefined();
    expect(fakeTauri.protectCalls).toBe(0);
  });
});
