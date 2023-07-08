import { cloneDeep, mergeWith } from 'lodash';
import { VRCHAT_API_SETTINGS_DEFAULT, VRChatApiSettings } from '../models/vrchat-api-settings';
import { info } from 'tauri-plugin-log-api';

const migrations: { [v: number]: (data: any) => any } = {
  1: toLatest,
};

export function migrateVRChatApiSettings(data: any): VRChatApiSettings {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > VRCHAT_API_SETTINGS_DEFAULT.version) {
    data = toLatest(data);
    info(
      `[vrchat-api-settings-migrations] Reset future VRChat API settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < VRCHAT_API_SETTINGS_DEFAULT.version) {
    data = migrations[++currentVersion](data);
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

function toLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(VRCHAT_API_SETTINGS_DEFAULT);
  return data;
}
