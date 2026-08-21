import { describe, expect, it } from 'vitest';
import { migrateVRChatApiSettings } from './vrchat-api-settings.migrations';
import { fakeTauri } from '../../testing/fake-tauri';
import {
  corruptLegacyValue,
  createLegacyKey,
  legacyCredentials,
  legacyEncrypt,
} from '../../testing/legacy-storage-crypto';

function legacyProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    sourceProfileId: null,
    restoreProfileId: null,
    userId: 'usr_1',
    username: 'user',
    displayName: 'User',
    draft: false,
    authCookie: 'auth-cookie',
    twoFactorCookie: null,
    twoFactorCookieLoginIdentifierHash: null,
    rememberCredentials: true,
    ...overrides,
  };
}

function store(profiles: Record<string, unknown>[], legacyCredentialCryptoKey: string | null) {
  return {
    version: 6,
    profiles,
    activeProfileId: profiles[0]?.['id'] ?? null,
    legacyCredentialCryptoKey,
  };
}

describe('migrateVRChatApiSettings, version 6 to 7', () => {
  it('leaves a profile whose secret is already protected alone', async () => {
    const protectedSecret = fakeTauri.protect('{"authCookie":"auth-cookie"}');
    const migrated = await migrateVRChatApiSettings(
      store(
        [
          {
            id: 'profile-1',
            sourceProfileId: null,
            restoreProfileId: null,
            userId: 'usr_1',
            username: 'user',
            displayName: 'User',
            draft: false,
            protectedSecret,
          },
        ],
        null
      )
    );

    expect(migrated.version).toBe(7);
    expect(migrated.profiles[0].protectedSecret).toBe(protectedSecret);
    expect('rememberCredentials' in (migrated.profiles[0] as object)).toBe(false);
    expect(migrated).not.toHaveProperty('legacyCredentialCryptoKey');
    expect(fakeTauri.backups).toHaveLength(0);
    expect(fakeTauri.dialogs).toHaveLength(0);
  });

  it('decrypts the credentials and the pending two factor identifier', async () => {
    const { key, serialized } = await createLegacyKey();
    const migrated = await migrateVRChatApiSettings(
      store(
        [
          legacyProfile({
            rememberedCredentials: await legacyCredentials(key, 'user@example.com', 'pässword'),
            encryptedPendingTwoFactorLoginIdentifier: await legacyEncrypt(key, 'pending-id'),
          }),
        ],
        serialized
      )
    );

    expect(migrated.profiles[0].rememberedCredentials).toEqual({
      username: 'user@example.com',
      password: 'pässword',
    });
    expect(migrated.profiles[0].pendingTwoFactorLoginIdentifier).toBe('pending-id');
    expect(migrated.profiles[0].rememberCredentials).toBe(true);
    expect(migrated.profiles[0]).not.toHaveProperty('encryptedPendingTwoFactorLoginIdentifier');
    expect(fakeTauri.backups).toHaveLength(0);
  });

  it('keeps rememberCredentials false when the profile did not remember them', async () => {
    const { key, serialized } = await createLegacyKey();
    const migrated = await migrateVRChatApiSettings(
      store(
        [
          legacyProfile({
            rememberCredentials: false,
            rememberedCredentials: await legacyCredentials(key, 'user', 'pw'),
          }),
        ],
        serialized
      )
    );

    expect(migrated.profiles[0].rememberedCredentials).toEqual({
      username: 'user',
      password: 'pw',
    });
    expect(migrated.profiles[0].rememberCredentials).toBe(false);
  });

  it('discards credentials it cannot decrypt, and backs the store up', async () => {
    const { serialized } = await createLegacyKey();
    const migrated = await migrateVRChatApiSettings(
      store([legacyProfile({ rememberedCredentials: corruptLegacyValue() })], serialized)
    );

    expect(migrated.version).toBe(7);
    expect(migrated.profiles[0].rememberedCredentials).toBeNull();
    expect(migrated.profiles[0].rememberCredentials).toBe(false);
    expect(migrated.profiles[0].authCookie).toBe('auth-cookie');
    expect(fakeTauri.dialogs).toHaveLength(0);
    expect(fakeTauri.backups).toHaveLength(1);
    expect(JSON.parse(fakeTauri.backups[0].contents).legacyCredentialCryptoKey).toBe(serialized);
  });

  it('discards encrypted credentials when the key is missing', async () => {
    const migrated = await migrateVRChatApiSettings(
      store([legacyProfile({ rememberedCredentials: corruptLegacyValue() })], null)
    );

    expect(migrated.profiles[0].rememberedCredentials).toBeNull();
    expect(fakeTauri.backups).toHaveLength(1);
  });

  it('discards every encrypted value when the key cannot be read', async () => {
    const { key } = await createLegacyKey();
    const migrated = await migrateVRChatApiSettings(
      store(
        [
          legacyProfile({
            rememberedCredentials: await legacyCredentials(key, 'user', 'pw'),
            encryptedPendingTwoFactorLoginIdentifier: await legacyEncrypt(key, 'pending-id'),
          }),
        ],
        'garbage$key'
      )
    );

    expect(migrated.profiles[0].rememberedCredentials).toBeNull();
    expect(migrated.profiles[0].pendingTwoFactorLoginIdentifier).toBeNull();
    expect(fakeTauri.logsMatching("Couldn't read the credential key")).toHaveLength(1);
    expect(fakeTauri.dialogs).toHaveLength(0);
  });

  it('discards a credential payload that is not base64, and logs it once', async () => {
    const { key, serialized } = await createLegacyKey();
    const migrated = await migrateVRChatApiSettings(
      store(
        [legacyProfile({ rememberedCredentials: await legacyEncrypt(key, 'not:base64!!') })],
        serialized
      )
    );

    expect(migrated.profiles[0].rememberedCredentials).toBeNull();
    expect(fakeTauri.logsMatching('Discarded the credentials')).toHaveLength(1);
    expect(fakeTauri.dialogs).toHaveLength(0);
  });

  it('discards credentials of the wrong shape', async () => {
    const migrated = await migrateVRChatApiSettings(
      store([legacyProfile({ rememberedCredentials: { username: 'user' } })], null)
    );

    expect(migrated.profiles[0].rememberedCredentials).toBeNull();
    expect(migrated.profiles[0].rememberCredentials).toBe(false);
    expect(fakeTauri.backups).toHaveLength(1);
  });

  it('keeps credentials that are already a valid object', async () => {
    const migrated = await migrateVRChatApiSettings(
      store([legacyProfile({ rememberedCredentials: { username: 'user', password: 'pw' } })], null)
    );

    expect(migrated.profiles[0].rememberedCredentials).toEqual({
      username: 'user',
      password: 'pw',
    });
    expect(migrated.profiles[0].rememberCredentials).toBe(true);
    expect(fakeTauri.backups).toHaveLength(0);
  });

  it('discards a secret field that is not a string', async () => {
    const migrated = await migrateVRChatApiSettings(
      store([legacyProfile({ authCookie: 42 })], null)
    );

    expect(migrated.profiles[0].authCookie).toBeNull();
    expect(fakeTauri.backups).toHaveLength(1);
  });

  it('survives a store with no profiles', async () => {
    const migrated = await migrateVRChatApiSettings({
      version: 6,
      activeProfileId: null,
      legacyCredentialCryptoKey: null,
    });

    expect(migrated.version).toBe(7);
    expect(migrated.profiles).toEqual([]);
    expect(fakeTauri.dialogs).toHaveLength(0);
  });

  it('leaves a healthy profile alone when another one fails', async () => {
    const { key, serialized } = await createLegacyKey();
    const migrated = await migrateVRChatApiSettings(
      store(
        [
          legacyProfile({
            id: 'good',
            rememberedCredentials: await legacyCredentials(key, 'user', 'pw'),
          }),
          legacyProfile({ id: 'bad', rememberedCredentials: corruptLegacyValue() }),
        ],
        serialized
      )
    );

    expect(migrated.profiles[0].rememberedCredentials).toEqual({
      username: 'user',
      password: 'pw',
    });
    expect(migrated.profiles[1].rememberedCredentials).toBeNull();
    expect(fakeTauri.dialogs).toHaveLength(0);
  });
});
