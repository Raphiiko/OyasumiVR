import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTauri } from '../../testing/fake-tauri';

const store = new Map<string, unknown>();

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get(key: string) {
      return store.get(key);
    }
    async set(key: string, value: unknown) {
      store.set(key, structuredClone(value));
    }
    async entries() {
      return [...store.entries()];
    }
    async reload() {}
  },
}));

const { AppSettingsService } = await import('./app-settings.service');
const { PulsoidService } = await import('./integrations/pulsoid.service');
const { SETTINGS_KEY_APP_SETTINGS, SETTINGS_KEY_PULSOID_API } = await import('../globals');

function appSettings() {
  return new AppSettingsService({ setActiveLang: () => undefined } as never, {} as never);
}

function pulsoid() {
  return new PulsoidService({} as never) as never as {
    loadSettings(): Promise<void>;
    saveSettings(): Promise<void>;
  };
}

function stored<T>(key: string): T {
  return store.get(key) as T;
}

beforeEach(() => store.clear());

describe('AppSettingsService, the MQTT password', () => {
  it('unlocks it on load and never writes it in plain text', async () => {
    store.set(SETTINGS_KEY_APP_SETTINGS, {
      version: 12,
      mqttPassword: null,
      mqttProtectedPassword: fakeTauri.protect('hunter2'),
    });
    const service = appSettings();
    await service.loadSettings();

    expect(service.settingsSync.mqttPassword).toBe('hunter2');
    expect(service.settingsSync.mqttProtectedPassword).toBeNull();
    const persisted = stored<{ mqttPassword: unknown; mqttProtectedPassword: string }>(
      SETTINGS_KEY_APP_SETTINGS
    );
    expect(persisted.mqttPassword).toBeNull();
    expect(fakeTauri.unprotect(persisted.mqttProtectedPassword)).toBe('hunter2');
  });

  it('does not protect the same password again on a second save', async () => {
    store.set(SETTINGS_KEY_APP_SETTINGS, {
      version: 12,
      mqttProtectedPassword: fakeTauri.protect('hunter2'),
    });
    const service = appSettings();
    await service.loadSettings();
    const first = stored<{ mqttProtectedPassword: string }>(
      SETTINGS_KEY_APP_SETTINGS
    ).mqttProtectedPassword;
    await service.saveSettings();

    expect(
      stored<{ mqttProtectedPassword: string }>(SETTINGS_KEY_APP_SETTINGS).mqttProtectedPassword
    ).toBe(first);
  });

  it('protects a password the migration left in plain text', async () => {
    store.set(SETTINGS_KEY_APP_SETTINGS, { version: 12, mqttPassword: 'hunter2' });
    const service = appSettings();
    await service.loadSettings();

    expect(service.settingsSync.mqttPassword).toBe('hunter2');
    const persisted = stored<{ mqttPassword: unknown; mqttProtectedPassword: string }>(
      SETTINGS_KEY_APP_SETTINGS
    );
    expect(persisted.mqttPassword).toBeNull();
    expect(fakeTauri.unprotect(persisted.mqttProtectedPassword)).toBe('hunter2');
  });

  it('keeps a password it cannot unlock, and writes no plain text', async () => {
    store.set(SETTINGS_KEY_APP_SETTINGS, {
      version: 12,
      mqttProtectedPassword: 'not-a-blob',
    });
    const service = appSettings();
    await service.loadSettings();

    expect(service.settingsSync.mqttPassword).toBeNull();
    const persisted = stored<{ mqttPassword: unknown; mqttProtectedPassword: string }>(
      SETTINGS_KEY_APP_SETTINGS
    );
    expect(persisted.mqttProtectedPassword).toBe('not-a-blob');
    expect(persisted.mqttPassword).toBeNull();
  });

  it('writes no password at all when protecting fails', async () => {
    store.set(SETTINGS_KEY_APP_SETTINGS, { version: 12, mqttPassword: 'hunter2' });
    fakeTauri.failProtect = true;
    const service = appSettings();
    await service.loadSettings();

    const persisted = stored<{ mqttPassword: unknown; mqttProtectedPassword: unknown }>(
      SETTINGS_KEY_APP_SETTINGS
    );
    expect(persisted.mqttPassword).toBeNull();
    expect(persisted.mqttProtectedPassword).toBeNull();
    expect(service.settingsSync.mqttPassword).toBe('hunter2');
  });
});

describe('PulsoidService, the access token', () => {
  it('unlocks it on load and never writes it in plain text', async () => {
    store.set(SETTINGS_KEY_PULSOID_API, {
      version: 2,
      protectedAccessToken: fakeTauri.protect('token-abc'),
      expiresAt: 4000000000,
    });
    const service = pulsoid();
    await service.loadSettings();

    const persisted = stored<{ accessToken: unknown; protectedAccessToken: string }>(
      SETTINGS_KEY_PULSOID_API
    );
    expect(persisted.accessToken).toBeUndefined();
    expect(fakeTauri.unprotect(persisted.protectedAccessToken)).toBe('token-abc');
  });

  it('protects a token the migration left in plain text', async () => {
    store.set(SETTINGS_KEY_PULSOID_API, {
      version: 2,
      accessToken: 'token-abc',
      expiresAt: 4000000000,
    });
    const service = pulsoid();
    await service.loadSettings();

    const persisted = stored<{ accessToken: unknown; protectedAccessToken: string }>(
      SETTINGS_KEY_PULSOID_API
    );
    expect(persisted.accessToken).toBeUndefined();
    expect(fakeTauri.unprotect(persisted.protectedAccessToken)).toBe('token-abc');
  });

  it('keeps a token it cannot unlock', async () => {
    store.set(SETTINGS_KEY_PULSOID_API, {
      version: 2,
      protectedAccessToken: 'not-a-blob',
      expiresAt: 4000000000,
      username: 'user',
    });
    const service = pulsoid();
    await service.loadSettings();

    const persisted = stored<{ protectedAccessToken: string; username: string }>(
      SETTINGS_KEY_PULSOID_API
    );
    expect(persisted.protectedAccessToken).toBe('not-a-blob');
    expect(persisted.username).toBe('user');
  });

  it('throws away a token that expired, even one it cannot unlock', async () => {
    store.set(SETTINGS_KEY_PULSOID_API, {
      version: 2,
      protectedAccessToken: 'not-a-blob',
      expiresAt: 1,
    });
    const service = pulsoid();
    await service.loadSettings();

    const persisted = stored<{ protectedAccessToken: unknown; expiresAt: unknown }>(
      SETTINGS_KEY_PULSOID_API
    );
    expect(persisted.protectedAccessToken).toBeUndefined();
    expect(persisted.expiresAt).toBeUndefined();
  });
});
