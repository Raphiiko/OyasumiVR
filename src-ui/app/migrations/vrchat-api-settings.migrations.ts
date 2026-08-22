import { mergeWith } from 'lodash';
import { VRCHAT_API_SETTINGS_DEFAULT, VRChatApiSettings } from '../models/vrchat-api-settings';
import { error, info } from '@tauri-apps/plugin-log';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';
import { message } from '@tauri-apps/plugin-dialog';
import { decryptStorageData, deserializeStorageCryptoKey } from './legacy/storage-crypto';

const migrations: { [v: number]: (data: any) => any } = {
  1: resetToLatest,
  2: from1To2,
  3: from2To3,
  4: from3To4,
  5: from4To5,
  6: from5To6,
  7: from6To7,
};

export async function migrateVRChatApiSettings(data: any): Promise<VRChatApiSettings> {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > VRCHAT_API_SETTINGS_DEFAULT.version) {
    data = resetToLatest(data);
    info(
      `[vrchat-api-settings-migrations] Reset future VRChat API settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < VRCHAT_API_SETTINGS_DEFAULT.version) {
    try {
      data = await migrations[++currentVersion](data);
    } catch (e) {
      error(
        "[vrchat-api-settings-migrations] Couldn't migrate to version " +
          currentVersion +
          '. Backing up configuration and resetting to the latest version. : ' +
          e
      );
      saveBackup(structuredClone(data));
      data = resetToLatest(data);
      currentVersion = data.version;
      message(
        'Your VRChat settings could not to be migrated to the new version of OyasumiVR, and have therefore been reset. Apologies for the inconvenience.\n\nPlease report this issue to the developer so this issue may be fixed in the future. Thank you!',
        { title: 'Migration Error (VRChat Settings)' }
      );
      continue;
    }
    currentVersion = data.version;
    info(
      `[vrchat-api-settings-migrations] Migrated VRChat API settings to version ${
        currentVersion + ''
      }`
    );
  }
  data = mergeWith(structuredClone(VRCHAT_API_SETTINGS_DEFAULT), data, (objValue, srcValue) => {
    // Delete irrelevant keys
    if (objValue === undefined) {
      return undefined;
    }
    // Do not merge array values
    if (Array.isArray(objValue)) {
      return srcValue;
    }
  });
  return data as VRChatApiSettings;
}

async function saveBackup(oldData: any) {
  await writeTextFile('vrchat-api-settings.backup.json', JSON.stringify(oldData, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

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
  const original = structuredClone(data);
  const legacyKey = data.legacyCredentialCryptoKey;
  let key: CryptoKey | null = null;
  if (legacyKey) {
    try {
      key = await deserializeStorageCryptoKey(legacyKey);
    } catch (e) {
      error("[vrchat-api-settings-migrations] Couldn't read the credential key: " + e);
    }
  }
  let discarded = false;
  data.profiles = await Promise.all(
    (data.profiles ?? []).map(async (profile: any) => {
      const migrated = { ...profile };
      if (migrated.encryptedPendingTwoFactorLoginIdentifier != null) {
        migrated.pendingTwoFactorLoginIdentifier = key
          ? await decryptLegacyValue(
              migrated.encryptedPendingTwoFactorLoginIdentifier,
              key,
              profile.id
            )
          : null;
        if (migrated.pendingTwoFactorLoginIdentifier == null) discarded = true;
        delete migrated.encryptedPendingTwoFactorLoginIdentifier;
      }
      if ('rememberedCredentials' in migrated) {
        const stored = migrated.rememberedCredentials;
        migrated.rememberedCredentials =
          typeof stored === 'string'
            ? key
              ? await decryptLegacyCredentials(stored, key, profile.id)
              : null
            : readCredentials(stored, profile.id);
        if (stored && migrated.rememberedCredentials == null) discarded = true;
      }
      migrated.rememberCredentials =
        !!migrated.rememberedCredentials && !!profile.rememberCredentials;
      for (const field of LEGACY_SECRET_TEXT_FIELDS) {
        if (field in migrated && migrated[field] != null && typeof migrated[field] !== 'string') {
          error(
            '[vrchat-api-settings-migrations] Discarded the ' +
              field +
              ' of profile ' +
              profile.id +
              ': not a string'
          );
          migrated[field] = null;
          discarded = true;
        }
      }
      return migrated;
    })
  );
  delete data.legacyCredentialCryptoKey;
  if (discarded) {
    await saveBackup(original).catch((e) =>
      error("[vrchat-api-settings-migrations] Couldn't write the backup: " + e)
    );
  }
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
  error(
    '[vrchat-api-settings-migrations] Discarded the credentials of profile ' +
      profileId +
      ': unexpected shape'
  );
  return null;
}

async function decryptLegacyValue(
  value: string,
  key: CryptoKey,
  profileId: string
): Promise<string | null> {
  try {
    return await decryptStorageData(value, key);
  } catch (e) {
    error(
      "[vrchat-api-settings-migrations] Couldn't decrypt a value for profile " +
        profileId +
        ': ' +
        e
    );
    return null;
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
  try {
    if (separator < 0) throw new Error('missing separator');
    return {
      username: atob(encoded.slice(0, separator)),
      password: atob(encoded.slice(separator + 1)),
    };
  } catch (e) {
    error(
      '[vrchat-api-settings-migrations] Discarded the credentials of profile ' +
        profileId +
        ': ' +
        e
    );
    return null;
  }
}

function resetToLatest(data: any): any {
  // Reset to latest
  data = structuredClone(VRCHAT_API_SETTINGS_DEFAULT);
  return data;
}
