import { mergeWith } from 'lodash';
import { error, info } from 'tauri-plugin-log-api';
import { PULSOID_API_SETTINGS_DEFAULT, PulsoidApiSettings } from '../models/pulsoid-api-settings';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';
import { message } from '@tauri-apps/plugin-dialog';

const migrations: { [v: number]: (data: any) => any } = {
  1: resetToLatest,
};

export function migratePulsoidApiSettings(data: any): PulsoidApiSettings {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > PULSOID_API_SETTINGS_DEFAULT.version) {
    data = resetToLatest(data);
    info(
      `[pulsoid-api-settings-migrations] Reset future Pulsoid API settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < PULSOID_API_SETTINGS_DEFAULT.version) {
    try {
      data = migrations[++currentVersion](data);
    } catch (e) {
      error(
        "[pulsoid-api-settings-migrations] Couldn't migrate to version " +
          currentVersion +
          '. Backing up configuration and resetting to the latest version. : ' +
          e
      );
      saveBackup(structuredClone(data));
      data = resetToLatest(data);
      currentVersion = data.version;
      message(
        'Your Pulsoid settings could not to be migrated to the new version of OyasumiVR, and have therefore been reset. Apologies for the inconvenience.\n\nPlease report this issue to the developer so this issue may be fixed in the future. Thank you!',
        { title: 'Migration Error (Pulsoid Settings)' }
      );
      continue;
    }
    currentVersion = data.version;
    info(
      `[pulsoid-api-settings-migrations] Migrated Pulsoid API settings to version ${
        currentVersion + ''
      }`
    );
  }
  data = mergeWith(structuredClone(PULSOID_API_SETTINGS_DEFAULT), data, (objValue, srcValue) => {
    if (Array.isArray(objValue)) {
      return srcValue;
    }
  });
  return data as PulsoidApiSettings;
}

async function saveBackup(oldData: any) {
  await writeTextFile('pulsoid-api-settings.backup.json', JSON.stringify(oldData, null, 2), {
    dir: BaseDirectory.AppData,
  });
}

function resetToLatest(data: any): any {
  // Reset to latest
  data = structuredClone(PULSOID_API_SETTINGS_DEFAULT);
  return data;
}
