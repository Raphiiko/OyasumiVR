import { cloneDeep } from 'lodash';
import { AUTOMATION_CONFIGS_DEFAULT, AutomationConfigs } from '../models/automations';

const migrations: { [v: number]: (data: any) => any } = {
  1: toLatest,
  2: toLatest,
  3: from2to3,
  4: from3to4,
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

function from3to4(data: any): any {
  data.version = 4;
  data.CHANGE_STATUS_BASED_ON_PLAYER_COUNT = cloneDeep(AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_BASED_ON_PLAYER_COUNT);
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
