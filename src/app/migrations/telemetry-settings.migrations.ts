import { cloneDeep, merge } from 'lodash';
import { TELEMETRY_SETTINGS_DEFAULT, TelemetrySettings } from '../models/telemetry-settings';
import { info } from 'tauri-plugin-log-api';
import { v4 as uuidv4 } from 'uuid';

const migrations: { [v: number]: (data: any) => any } = {
  1: toLatest,
};

export function migrateTelemetrySettings(data: any): TelemetrySettings {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > TELEMETRY_SETTINGS_DEFAULT.version) {
    data = toLatest(data);
    info(
      `[telemetry-settings-migrations] Reset future telemetry settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < TELEMETRY_SETTINGS_DEFAULT.version) {
    data = migrations[++currentVersion](data);
    currentVersion = data.version;
    info(
      `[telemetry-settings-migrations] Migrated telemetry settings to version ${
        currentVersion + ''
      }`
    );
  }
  data = merge({}, TELEMETRY_SETTINGS_DEFAULT, data);
  return data as TelemetrySettings;
}

function toLatest(data: any): any {
  // Reset to latest
  const telemetryId = data.telemetryId || uuidv4();
  data = cloneDeep(TELEMETRY_SETTINGS_DEFAULT);
  data.telemetryId = telemetryId;
  return data;
}
