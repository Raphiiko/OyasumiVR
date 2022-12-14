import { cloneDeep } from 'lodash';
import { AUTOMATION_CONFIGS_DEFAULT, AutomationConfigs } from '../models/automations';
import { info } from 'tauri-plugin-log-api';

const migrations: { [v: number]: (data: any) => any } = {
  1: toLatest,
  2: toLatest,
  3: from2to3,
  4: from3to4,
  5: from4to5,
};

export function migrateAutomationConfigs(data: any): AutomationConfigs {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > AUTOMATION_CONFIGS_DEFAULT.version) {
    data = toLatest(data);
    info(
      `[automation-configs-migrations] Reset future automation configs version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < AUTOMATION_CONFIGS_DEFAULT.version) {
    data = migrations[++currentVersion](cloneDeep(data));
    currentVersion = data.version;
    info(
      `[automation-configs-migrations] Migrated automation configs to version ${
        currentVersion + ''
      }`
    );
  }
  return data as AutomationConfigs;
}

function toLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(AUTOMATION_CONFIGS_DEFAULT);
  return data;
}

function from4to5(data: any): any {
  data.version = 5;
  data.AUTO_ACCEPT_INVITE_REQUESTS = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.AUTO_ACCEPT_INVITE_REQUESTS
  );
  return data;
}

function from3to4(data: any): any {
  data.version = 4;
  data.CHANGE_STATUS_BASED_ON_PLAYER_COUNT = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_BASED_ON_PLAYER_COUNT
  );
  return data;
}

function from2to3(data: any): any {
  data.version = 3;
  data.SLEEPING_ANIMATIONS = cloneDeep(AUTOMATION_CONFIGS_DEFAULT.SLEEPING_ANIMATIONS);
  return data;
}

function from0to1(data: any): any {
  data.version = 1;
  return data;
}
