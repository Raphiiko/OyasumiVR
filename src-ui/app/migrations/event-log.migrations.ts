import { EVENT_LOG_DEFAULT } from '../models/event-log-entry';
import type { MigrationDefinition, Versioned } from 'src-shared-ts/src/migration-runner';
import { normalizeWithDefaults } from './migration-defaults';

function from4to5(data: any): any {
  data.version = 5;
  data.logs = data.logs.map((log: any) => {
    switch (log.type) {
      case 'displayBrightnessChanged':
        log.type = 'hardwareBrightnessChanged';
        break;
      case 'imageBrightnessChanged':
        log.type = 'softwareBrightnessChanged';
        break;
    }
    return log;
  });
  return data;
}

function from3to4(data: any): any {
  data.version = 4;
  data.logs = data.logs.map((log: any) => {
    if (log.type === 'windowsPowerPolicySet') {
      switch (log.policy) {
        case 'HIGH_PERFORMANCE':
          log.policyName = 'High Performance';
          break;
        case 'BALANCED':
          log.policyName = 'Balanced';
          break;
        case 'POWER_SAVING':
          log.policyName = 'Power Saving';
          break;
        default:
          log.policyName = 'Unknown Policy';
          break;
      }
    }
    return log;
  });
  return data;
}

function from2to3(data: any): any {
  data.version = 3;
  data.logs = data.logs.map((log: any) => {
    if (log.type === 'brightnessChanged') {
      log.type = 'displayBrightnessChanged';
    }
    return log;
  });
  return data;
}

function from1to2(data: any): any {
  data.version = 2;
  data.logs = data.logs.map((log: any) => {
    if (log.type === 'turnedOffDevices') {
      log.type = 'turnedOffOpenVRDevices';
    }
    return log;
  });
  return data;
}

export const EVENT_LOG_MIGRATION: MigrationDefinition<Versioned> = {
  targetVersion: EVENT_LOG_DEFAULT.version,
  minimumSupportedVersion: 1,
  steps: {
    1: from1to2,
    2: from2to3,
    3: from3to4,
    4: from4to5,
  },
  normalizeCurrentVersion: (data) => normalizeWithDefaults(EVENT_LOG_DEFAULT, data),
};
