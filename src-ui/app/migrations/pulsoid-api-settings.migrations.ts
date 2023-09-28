import { cloneDeep, mergeWith } from 'lodash';
import { info } from 'tauri-plugin-log-api';
import { PULSOID_API_SETTINGS_DEFAULT, PulsoidApiSettings } from '../models/pulsoid-api-settings';

const migrations: { [v: number]: (data: any) => any } = {
  1: toLatest,
};

export function migratePulsoidApiSettings(data: any): PulsoidApiSettings {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > PULSOID_API_SETTINGS_DEFAULT.version) {
    data = toLatest(data);
    info(
      `[pulsoid-api-settings-migrations] Reset future Pulsoid API settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < PULSOID_API_SETTINGS_DEFAULT.version) {
    data = migrations[++currentVersion](data);
    currentVersion = data.version;
    info(
      `[pulsoid-api-settings-migrations] Migrated Pulsoid API settings to version ${
        currentVersion + ''
      }`
    );
  }
  data = mergeWith(cloneDeep(PULSOID_API_SETTINGS_DEFAULT), data, (objValue, srcValue) => {
    if (Array.isArray(objValue)) {
      return srcValue;
    }
  });
  return data as PulsoidApiSettings;
}

function toLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(PULSOID_API_SETTINGS_DEFAULT);
  return data;
}
