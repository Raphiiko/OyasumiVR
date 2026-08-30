import { APP_SETTINGS_DEFAULT } from '../models/settings';
import type { MigrationDefinition, Versioned } from 'src-shared-ts/src/migration-runner';
import { migrateLighthouseDeviceId } from './lighthouse-device-id';
import { protectSecret } from '../utils/secrets';
import { normalizeWithDefaults } from './migration-defaults';

function from12to13(data: any): any {
  data.version = 13;
  data.elevatedFeaturesEnabled = !!data.askForAdminOnStart;
  delete data.askForAdminOnStart;
  return data;
}

async function from11to12(data: any): Promise<any> {
  data.mqttProtectedPassword = await protectSecret(data.mqttPassword);
  data.mqttPassword = null;
  data.version = 12;
  return data;
}

function from10to11(data: any): any {
  data.version = 11;
  if (data.v1LighthouseIdentifiers) {
    data.v1LighthouseIdentifiers = Object.fromEntries(
      Object.entries(data.v1LighthouseIdentifiers).map(([id, identifier]) => [
        migrateLighthouseDeviceId(id) ?? id,
        identifier,
      ])
    );
  }
  return data;
}

function from9to10(data: any): any {
  data.version = 10;
  data.overlayGpuAcceleration = !(data.overlayGpuFix ?? false);
  delete data.overlayGpuFix;

  if (data.oneTimeFlags) {
    data.oneTimeFlags = data.oneTimeFlags.filter(
      (flag: string) =>
        flag !== 'BRIGHTNESS_AUTOMATION_ON_HMD_CONNECT_EVENT_FEATURE' &&
        flag !== 'BASESTATION_COUNT_WARNING_DIALOG'
    );
  }

  delete data.deviceNicknames;

  delete data.ignoredLighthouses;

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
  return data;
}

function from1to2(data: any): any {
  data.version = 2;
  data.askForAdminOnStart = false;
  return data;
}

export const APP_SETTINGS_MIGRATION: MigrationDefinition<Versioned> = {
  targetVersion: APP_SETTINGS_DEFAULT.version,
  minimumSupportedVersion: 1,
  steps: {
    1: from1to2,
    2: from2to3,
    3: from3to4,
    4: from4to5,
    5: from5to6,
    6: from6to7,
    7: from7to8,
    8: from8to9,
    9: from9to10,
    10: from10to11,
    11: from11to12,
    12: from12to13,
  },
  normalizeCurrentVersion: (data) => normalizeWithDefaults(APP_SETTINGS_DEFAULT, data),
};
