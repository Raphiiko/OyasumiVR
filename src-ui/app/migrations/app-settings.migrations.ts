import { mergeWith } from 'lodash';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import { error, info } from '@tauri-apps/plugin-log';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';
import { message } from '@tauri-apps/plugin-dialog';

const migrations: { [v: number]: (data: any) => any } = {
  1: resetToLatest,
  2: from1to2,
  3: from2to3,
  4: from3to4,
  5: from4to5,
  6: from5to6,
  7: from6to7,
  8: from7to8,
  9: from8to9,
  10: from9to10,
};

export function migrateAppSettings(data: any): AppSettings {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > APP_SETTINGS_DEFAULT.version) {
    data = resetToLatest(data);
    info(
      `[app-settings-migrations] Reset future app settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < APP_SETTINGS_DEFAULT.version) {
    try {
      data = migrations[++currentVersion](data);
    } catch (e) {
      error(
        "[app-settings-migrations] Couldn't migrate to version " +
          currentVersion +
          '. Backing up configuration and resetting to the latest version. : ' +
          e
      );
      saveBackup(structuredClone(data));
      data = resetToLatest(data);
      currentVersion = data.version;
      message(
        'Your application settings could not to be migrated to the new version of OyasumiVR, and have therefore been reset. Apologies for the inconvenience.\n\nPlease report this issue to the developer so this issue may be fixed in the future. Thank you!',
        { title: 'Migration Error (App Settings)' }
      );
      continue;
    }
    currentVersion = data.version;
    info(`[app-settings-migrations] Migrated app settings to version ${currentVersion + ''}`);
  }
  data = mergeWith(structuredClone(APP_SETTINGS_DEFAULT), data, (objValue, srcValue) => {
    if (Array.isArray(objValue)) {
      return srcValue;
    }
  });
  return data as AppSettings;
}

async function saveBackup(oldData: any) {
  await writeTextFile('app-settings.backup.json', JSON.stringify(oldData, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

function resetToLatest(data: any): any {
  // Reset to latest
  data = structuredClone(APP_SETTINGS_DEFAULT);
  return data;
}

function from9to10(data: any): any {
  data.version = 10;
  data.overlayGpuAcceleration = !(data.overlayGpuFix ?? false);
  delete data.overlayGpuFix;
  
  // Remove unused one-time flags
  if (data.oneTimeFlags) {
    data.oneTimeFlags = data.oneTimeFlags.filter(
      (flag: string) => 
        flag !== 'BRIGHTNESS_AUTOMATION_ON_HMD_CONNECT_EVENT_FEATURE' && 
        flag !== 'BASESTATION_COUNT_WARNING_DIALOG'
    );
  }
  
  return data;
}

function from8to9(data: any): any {
  data.version = 9;
  data.notificationsEnabled = {
    types: (data.notificationsEnabled?.types ?? []).map((t: string) => {
      switch (t) {
        case 'AUTO_UPDATED_STATUS_PLAYERCOUNT':
          return 'AUTO_UPDATED_VRC_STATUS';
        default:
          return t;
      }
    }),
  };
  return data;
}

function from7to8(data: any): any {
  data.version = 8;
  delete data.oscSendingPort;
  delete data.oscSendingHost;
  delete data.oscReceivingPort;
  delete data.oscReceivingHost;
  delete data.oscEnableExpressionMenu;
  delete data.oscEnableExternalControl;
  return data;
}

function from6to7(data: any): any {
  data.version = 7;
  delete data.overlayActivationAction;
  delete data.overlayActivationController;
  delete data.overlayActivationTriggerRequired;
  return data;
}

function from5to6(data: any): any {
  data.version = 6;
  delete data.enableXSOverlayNotifications;
  delete data.enableDesktopNotifications;
  return data;
}

function from4to5(data: any): any {
  data.version = 5;
  data.userLanguagePicked = true;
  return data;
}

function from3to4(data: any): any {
  data.version = 4;
  if (data.userLanguage === 'jp') {
    data.userLanguage = 'ja';
  }
  return data;
}

function from2to3(data: any): any {
  data.version = 3;
  // Missing keys are now always added by default
  return data;
}

function from1to2(data: any): any {
  data.version = 2;
  data.askForAdminOnStart = false;
  return data;
}
