import { cloneDeep, mergeWith } from 'lodash';
import { VRCHAT_API_SETTINGS_DEFAULT, VRChatApiSettings } from '../models/vrchat-api-settings';
import { error, info } from 'tauri-plugin-log-api';
import { BaseDirectory, writeTextFile } from '@tauri-apps/api/fs';
import { message } from '@tauri-apps/api/dialog';

const migrations: { [v: number]: (data: any) => any } = {
  1: resetToLatest,
  2: from1To2,
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
      saveBackup(cloneDeep(data));
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
  data = mergeWith(cloneDeep(VRCHAT_API_SETTINGS_DEFAULT), data, (objValue, srcValue) => {
    if (Array.isArray(objValue)) {
      return srcValue;
    }
  });
  return data as VRChatApiSettings;
}

async function saveBackup(oldData: any) {
  await writeTextFile('vrchat-api-settings.backup.json', JSON.stringify(oldData, null, 2), {
    dir: BaseDirectory.AppData,
  });
}

function from1To2(data: any): any {
  delete data['apiKey'];
  delete data['apiKeyExpiry'];
  data.version = 2;
  return data;
}

function resetToLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(VRCHAT_API_SETTINGS_DEFAULT);
  return data;
}
