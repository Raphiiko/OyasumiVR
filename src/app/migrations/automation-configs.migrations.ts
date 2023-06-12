import { cloneDeep, merge } from 'lodash';
import { AUTOMATION_CONFIGS_DEFAULT, AutomationConfigs } from '../models/automations';
import { info } from 'tauri-plugin-log-api';

const migrations: { [v: number]: (data: any) => any } = {
  1: resetToLatest,
  2: resetToLatest,
  3: from2to3,
  4: from3to4,
  5: from4to5,
  6: from5to6,
  7: from6to7,
  8: from7to8,
};

export function migrateAutomationConfigs(data: any): AutomationConfigs {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > AUTOMATION_CONFIGS_DEFAULT.version) {
    data = resetToLatest(data);
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
  data = merge({}, AUTOMATION_CONFIGS_DEFAULT, data);
  return data as AutomationConfigs;
}

function resetToLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(AUTOMATION_CONFIGS_DEFAULT);
  return data;
}

function from7to8(data: any): any {
  data.version = 8;
  // Missing keys are now always added by default
  return data;
}

function from6to7(data: any): any {
  data.version = 7;
  // Missing keys are now always added by default
  return data;
}

function from5to6(data: any): any {
  data.version = 6;
  data.MSI_AFTERBURNER = cloneDeep(AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER);
  data.MSI_AFTERBURNER.enabled = data.GPU_POWER_LIMITS.enabled;
  return data;
}

function from4to5(data: any): any {
  data.version = 5;
  // Missing keys are now always added by default
  return data;
}

function from3to4(data: any): any {
  data.version = 4;
  // Missing keys are now always added by default
  return data;
}

function from2to3(data: any): any {
  data.version = 3;
  // Missing keys are now always added by default
  return data;
}
