import { cloneDeep } from 'lodash';
import { AUTOMATION_CONFIGS_DEFAULT, AutomationConfigs } from '../models/automations';

const migrations: { [v: number]: (data: any) => any } = {
  1: from0to1,
  2: toLatest,
};

export function migrateAutomationConfigs(data: any): AutomationConfigs {
  let currentVersion = data.version || 0;
  while (currentVersion < AUTOMATION_CONFIGS_DEFAULT.version) {
    data = migrations[++currentVersion](cloneDeep(data));
    currentVersion = data.version;
    console.log(`Migrated automation configs to version ${currentVersion + ''}`);
  }
  return data as AutomationConfigs;
}

function toLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(AUTOMATION_CONFIGS_DEFAULT);
  return data;
}

function from0to1(data: any): any {
  data.version = 1;
  return data;
}
