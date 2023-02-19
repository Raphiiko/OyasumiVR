import { cloneDeep } from 'lodash';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import { info } from 'tauri-plugin-log-api';

const migrations: { [v: number]: (data: any) => any } = {
  1: toLatest,
  2: from1to2,
  3: from2to3,
};

export function migrateAppSettings(data: any): AppSettings {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > APP_SETTINGS_DEFAULT.version) {
    data = toLatest(data);
    info(
      `[app-settings-migrations] Reset future app settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < APP_SETTINGS_DEFAULT.version) {
    data = migrations[++currentVersion](data);
    currentVersion = data.version;
    info(`[app-settings-migrations] Migrated app settings to version ${currentVersion + ''}`);
  }
  return data as AppSettings;
}

function toLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(APP_SETTINGS_DEFAULT);
  return data;
}

function from2to3(data: any): any {
  data.version = 3;
  data.oscSendingHost = APP_SETTINGS_DEFAULT.oscSendingHost;
  data.oscSendingPort = APP_SETTINGS_DEFAULT.oscSendingPort;
  data.oscReceivingHost = APP_SETTINGS_DEFAULT.oscReceivingHost;
  data.oscReceivingPort = APP_SETTINGS_DEFAULT.oscReceivingPort;
  return data;
}

function from1to2(data: any): any {
  data.version = 2;
  data.askForAdminOnStart = false;
  return data;
}
