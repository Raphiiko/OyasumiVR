import { cloneDeep } from 'lodash';
import { TELEMETRY_SETTINGS_DEFAULT, TelemetrySettings } from '../models/telemetry-settings';

const migrations: { [v: number]: (data: any) => any } = {
  1: toLatest,
};

export function migrateTelemetrySettings(data: any): TelemetrySettings {
  let currentVersion = data.version || 0;
  while (currentVersion < TELEMETRY_SETTINGS_DEFAULT.version) {
    data = migrations[++currentVersion](data);
    currentVersion = data.version;
    console.log(`Migrated telemetry settings to version ${currentVersion + ''}`);
  }
  return data as TelemetrySettings;
}

function toLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(TELEMETRY_SETTINGS_DEFAULT);
  return data;
}
