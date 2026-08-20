import { mergeWith } from 'lodash';
import { VRCHAT_API_SETTINGS_DEFAULT, VRChatApiSettings } from '../models/vrchat-api-settings';
import { error, info } from '@tauri-apps/plugin-log';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';
import { message } from '@tauri-apps/plugin-dialog';

const migrations: { [v: number]: (data: any) => any } = {
  1: resetToLatest,
  2: from1To2,
  3: from2To3,
  4: from3To4,
  5: from4To5,
  6: from5To6,
};

export function migrateVRChatApiSettings(data: any): VRChatApiSettings {
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
      data = migrations[++currentVersion](data);
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

function resetToLatest(data: any): any {
  // Reset to latest
  data = structuredClone(VRCHAT_API_SETTINGS_DEFAULT);
  return data;
}
