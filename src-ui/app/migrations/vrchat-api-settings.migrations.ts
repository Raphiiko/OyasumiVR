import { VRCHAT_API_SETTINGS_DEFAULT } from '../models/vrchat-api-settings';
import type { MigrationDefinition, Versioned } from 'src-shared-ts/src/migration-runner';
import { decryptStorageData, deserializeStorageCryptoKey } from './legacy/storage-crypto';
import { protectSecret } from '../utils/secrets';
import { normalizeWithDefaults } from './migration-defaults';

function from1To2(data: any): any {
  delete data['apiKey'];
  delete data['apiKeyExpiry'];
  data.version = 2;
  return data;
}

function from2To3(data: any): any {
  data.twoFactorCookieLoginIdentifierHash = null;
  data.version = 3;
  return data;
}

function from3To4(data: any): any {
  delete data['authCookieExpiry'];
  delete data['twoFactorCookieExpiry'];
  data.encryptedPendingTwoFactorLoginIdentifier = null;
  data.version = 4;
  return data;
}

function from4To5(data: any): any {
  const hasProfile = !!(
    data.authCookie != null ||
    data.twoFactorCookie != null ||
    data.encryptedPendingTwoFactorLoginIdentifier != null ||
    data.rememberedCredentials != null
  );
  const profileId = crypto.randomUUID();
  data.profiles = hasProfile
    ? [
        {
          id: profileId,
          sourceProfileId: null,
          restoreProfileId: null,
          userId: null,
          username: null,
          displayName: null,
          draft: false,
          authCookie: data.authCookie ?? null,
          twoFactorCookie: data.twoFactorCookie ?? null,
          twoFactorCookieLoginIdentifierHash: data.twoFactorCookieLoginIdentifierHash ?? null,
          encryptedPendingTwoFactorLoginIdentifier:
            data.encryptedPendingTwoFactorLoginIdentifier ?? null,
          rememberCredentials: !!data.rememberCredentials,
          rememberedCredentials: data.rememberedCredentials ?? null,
        },
      ]
    : [];
  data.activeProfileId = hasProfile ? profileId : null;
  delete data.authCookie;
  delete data.twoFactorCookie;
  delete data.twoFactorCookieLoginIdentifierHash;
  delete data.encryptedPendingTwoFactorLoginIdentifier;
  delete data.rememberCredentials;
  delete data.rememberedCredentials;
  data.version = 5;
  return data;
}

function from5To6(data: any): any {
  data.profiles = (data.profiles ?? []).map((profile: any) => ({
    ...profile,
    protectedSecret: null,
  }));
  data.legacyCredentialCryptoKey = data.credentialCryptoKey ?? null;
  delete data.credentialCryptoKey;
  data.version = 6;
  return data;
}

const LEGACY_SECRET_TEXT_FIELDS = [
  'authCookie',
  'twoFactorCookie',
  'twoFactorCookieLoginIdentifierHash',
  'pendingTwoFactorLoginIdentifier',
];

async function from6To7(data: any): Promise<any> {
  const legacyKey = data.legacyCredentialCryptoKey;
  let key: CryptoKey | null = null;
  if (legacyKey) {
    key = await deserializeStorageCryptoKey(legacyKey);
  }
  data.profiles = await Promise.all(
    (data.profiles ?? []).map(async (profile: any) => {
      const migrated = { ...profile };
      if (migrated.encryptedPendingTwoFactorLoginIdentifier != null) {
        if (!key) throw new Error(`Profile ${profile.id} has encrypted data but no legacy key`);
        migrated.pendingTwoFactorLoginIdentifier = await decryptLegacyValue(
          migrated.encryptedPendingTwoFactorLoginIdentifier,
          key,
          profile.id
        );
        delete migrated.encryptedPendingTwoFactorLoginIdentifier;
      }
      if ('rememberedCredentials' in migrated) {
        const stored = migrated.rememberedCredentials;
        if (typeof stored === 'string') {
          if (!key)
            throw new Error(`Profile ${profile.id} has encrypted credentials but no legacy key`);
          migrated.rememberedCredentials = await decryptLegacyCredentials(stored, key, profile.id);
        } else {
          migrated.rememberedCredentials = readCredentials(stored, profile.id);
        }
      }
      migrated.rememberCredentials =
        !!migrated.rememberedCredentials && !!profile.rememberCredentials;
      for (const field of LEGACY_SECRET_TEXT_FIELDS) {
        if (field in migrated && migrated[field] != null && typeof migrated[field] !== 'string') {
          throw new Error(`The ${field} of profile ${profile.id} is not a string`);
        }
      }
      const protectedSecret = await protectSecret(
        JSON.stringify({
          authCookie: migrated.authCookie ?? null,
          twoFactorCookie: migrated.twoFactorCookie ?? null,
          twoFactorCookieLoginIdentifierHash: migrated.twoFactorCookieLoginIdentifierHash ?? null,
          pendingTwoFactorLoginIdentifier: migrated.pendingTwoFactorLoginIdentifier ?? null,
          rememberCredentials: migrated.rememberCredentials,
          rememberedCredentials: migrated.rememberedCredentials ?? null,
        })
      );
      if (!protectedSecret) throw new Error(`Profile ${profile.id} could not be protected`);
      return {
        id: migrated.id,
        sourceProfileId: migrated.sourceProfileId,
        restoreProfileId: migrated.restoreProfileId,
        userId: migrated.userId,
        username: migrated.username,
        displayName: migrated.displayName,
        draft: migrated.draft,
        protectedSecret,
      };
    })
  );
  delete data.legacyCredentialCryptoKey;
  data.version = 7;
  return data;
}

function readCredentials(
  value: any,
  profileId: string
): { username: string; password: string } | null {
  if (value == null) return null;
  if (typeof value?.username === 'string' && typeof value?.password === 'string') {
    return { username: value.username, password: value.password };
  }
  throw new Error(`The credentials of profile ${profileId} have an unexpected shape`);
}

async function decryptLegacyValue(
  value: string,
  key: CryptoKey,
  profileId: string
): Promise<string | null> {
  try {
    return await decryptStorageData(value, key);
  } catch (cause) {
    throw new Error(`Could not decrypt a value for profile ${profileId}`, { cause });
  }
}

async function decryptLegacyCredentials(
  value: string,
  key: CryptoKey,
  profileId: string
): Promise<{ username: string; password: string } | null> {
  const encoded = await decryptLegacyValue(value, key, profileId);
  if (encoded == null) return null;
  const separator = encoded.indexOf(':');
  if (separator < 0) throw new Error(`The credentials of profile ${profileId} have no separator`);
  return {
    username: atob(encoded.slice(0, separator)),
    password: atob(encoded.slice(separator + 1)),
  };
}

export const VRCHAT_API_MIGRATION: MigrationDefinition<Versioned> = {
  targetVersion: VRCHAT_API_SETTINGS_DEFAULT.version,
  minimumSupportedVersion: 1,
  steps: {
    1: from1To2,
    2: from2To3,
    3: from3To4,
    4: from4To5,
    5: from5To6,
    6: from6To7,
  },
  normalizeCurrentVersion: (data) => normalizeWithDefaults(VRCHAT_API_SETTINGS_DEFAULT, data),
};
