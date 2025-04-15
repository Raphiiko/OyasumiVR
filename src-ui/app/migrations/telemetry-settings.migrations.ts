import { mergeWith } from 'lodash';
import { TELEMETRY_SETTINGS_DEFAULT, TelemetrySettings } from '../models/telemetry-settings';
import { error, info } from 'tauri-plugin-log-api';
import { v4 as uuidv4 } from 'uuid';
import { message } from '@tauri-apps/plugin-dialog';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';

const migrations: { [v: number]: (data: any) => any } = {
  1: resetToLatest,
  2: from1to2,
};

export function migrateTelemetrySettings(data: any): TelemetrySettings {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > TELEMETRY_SETTINGS_DEFAULT.version) {
    data = resetToLatest(data);
    info(
      `[telemetry-settings-migrations] Reset future telemetry settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < TELEMETRY_SETTINGS_DEFAULT.version) {
    try {
      data = migrations[++currentVersion](data);
    } catch (e) {
      error(
        "[telemetry-settings-migrations] Couldn't migrate to version " +
          currentVersion +
          '. Backing up configuration and resetting to the latest version. : ' +
          e
      );
      saveBackup(structuredClone(data));
      data = resetToLatest(data);
      currentVersion = data.version;
      message(
        'Your telemetry settings could not to be migrated to the new version of OyasumiVR, and have therefore been reset. Apologies for the inconvenience.\n\nPlease report this issue to the developer so this issue may be fixed in the future. Thank you!',
        { title: 'Migration Error (Telemetry Settings)' }
      );
      continue;
    }
    currentVersion = data.version;
    info(
      `[telemetry-settings-migrations] Migrated telemetry settings to version ${
        currentVersion + ''
      }`
    );
  }
  data = mergeWith(structuredClone(TELEMETRY_SETTINGS_DEFAULT), data, (objValue, srcValue) => {
    if (Array.isArray(objValue)) {
      return srcValue;
    }
  });
  return data as TelemetrySettings;
}

async function saveBackup(oldData: any) {
  await writeTextFile('telemetry-settings.backup.json', JSON.stringify(oldData, null, 2), {
    dir: BaseDirectory.AppData,
  });
}

function from1to2(data: any): any {
  return {
    enabled: data.enabled,
    version: 2,
  };
}

function resetToLatest(data: any): any {
  // Reset to latest
  const telemetryId = data.telemetryId || uuidv4();
  data = structuredClone(TELEMETRY_SETTINGS_DEFAULT);
  data.telemetryId = telemetryId;
  return data;
}
