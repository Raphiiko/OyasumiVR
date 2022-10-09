import { cloneDeep } from 'lodash';
import { VRCHAT_API_SETTINGS_DEFAULT, VRChatApiSettings } from '../models/vrchat-api-settings';

const migrations: { [v: number]: (data: any) => any } = {
  1: toLatest,
};

export function migrateVRChatApiSettings(data: any): VRChatApiSettings {
  let currentVersion = data.version || 0;
  while (currentVersion < VRCHAT_API_SETTINGS_DEFAULT.version) {
    data = migrations[++currentVersion](data);
    currentVersion = data.version;
    console.log(`Migrated VRChat API settings to version ${currentVersion + ''}`);
  }
  return data as VRChatApiSettings;
}

function toLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(VRCHAT_API_SETTINGS_DEFAULT);
  return data;
}
