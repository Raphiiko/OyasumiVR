import { cloneDeep } from 'lodash';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';

const migrations: { [v: number]: (data: any) => any } = {
  1: from0to1,
};

export function migrateAppSettings(data: any): AppSettings {
  let currentVersion = data.version || 0;
  while (currentVersion < APP_SETTINGS_DEFAULT.version) {
    data = migrations[++currentVersion](data);
    currentVersion = data.version;
    console.log(`Migrated app settings to version ${currentVersion + ''}`);
  }
  return data as AppSettings;
}

function toLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(AUTOMATION_CONFIGS_DEFAULT);
  return data;
}

function from0to1(data: any): any {
  data.version = 1;
  return data;
}
