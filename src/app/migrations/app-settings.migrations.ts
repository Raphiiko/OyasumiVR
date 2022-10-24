import { cloneDeep } from 'lodash';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import { AppSettingsService } from '../services/app-settings.service';

const migrations: { [v: number]: (data: any) => any } = {
  1: toLatest,
  2: from1to2,
};

export function migrateAppSettings(data: any): AppSettings {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > APP_SETTINGS_DEFAULT.version) {
    data = toLatest(data);
    console.log(`Reset future app settings version back to version ${currentVersion + ''}`);
  }
  while (currentVersion < APP_SETTINGS_DEFAULT.version) {
    data = migrations[++currentVersion](data);
    currentVersion = data.version;
    console.log(`Migrated app settings to version ${currentVersion + ''}`);
  }
  return data as AppSettings;
}

function toLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(APP_SETTINGS_DEFAULT);
  return data;
}

function from1to2(data: any): any {
  data.version = 2;
  data.askForAdminOnStart = false;
  return data;
}
