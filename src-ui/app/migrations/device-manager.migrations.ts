import { mergeWith } from 'lodash';
import { error, info } from '@tauri-apps/plugin-log';
import { DEVICE_MANAGER_DATA_DEFAULT, DeviceManagerData } from '../models/device-manager';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';
import { message } from '@tauri-apps/plugin-dialog';

const migrations: { [v: number]: (data: any) => any } = {
  1: resetToLatest,
};

export function migrateDeviceManagerData(data: any): DeviceManagerData {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > DEVICE_MANAGER_DATA_DEFAULT.version) {
    data = resetToLatest(data);
    info(
      `[device-manager-migrations] Reset future Device Manager settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < DEVICE_MANAGER_DATA_DEFAULT.version) {
    try {
      data = migrations[++currentVersion](data);
    } catch (e) {
      error(
        "[device-manager-migrations] Couldn't migrate to version " +
          currentVersion +
          '. Backing up configuration and resetting to the latest version. : ' +
          e
      );
      saveBackup(structuredClone(data));
      data = resetToLatest(data);
      currentVersion = data.version;
      message(
        'Your Device Manager settings could not be migrated to the new version of OyasumiVR, and have therefore been reset. Apologies for the inconvenience.\n\nPlease report this issue to the developer so this issue may be fixed in the future. Thank you!',
        { title: 'Migration Error (Device Manager Settings)' }
      );
      continue;
    }
    currentVersion = data.version;
    info(
      `[device-manager-migrations] Migrated Device Manager settings to version ${
        currentVersion + ''
      }`
    );
  }
  data = mergeWith(structuredClone(DEVICE_MANAGER_DATA_DEFAULT), data, (objValue, srcValue) => {
    // Delete irrelevant keys
    if (objValue === undefined) {
      return undefined;
    }
    // Do not merge array values
    if (Array.isArray(objValue)) {
      return srcValue;
    }
  });
  return data as DeviceManagerData;
}

async function saveBackup(oldData: any) {
  await writeTextFile('device-manager.backup.json', JSON.stringify(oldData, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

function resetToLatest(data: any): any {
  // Reset to latest
  data = structuredClone(DEVICE_MANAGER_DATA_DEFAULT);
  return data;
}
