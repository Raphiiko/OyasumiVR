import { error, info } from 'tauri-plugin-log-api';

import { EVENT_LOG_DEFAULT, EventLog } from '../models/event-log-entry';
import { message } from '@tauri-apps/api/dialog';
import { BaseDirectory, writeTextFile } from '@tauri-apps/api/fs';

const migrations: { [v: number]: (data: any) => any } = {
  1: resetToLatest,
  2: from1to2,
  3: from2to3,
  4: from3to4,
  5: from4to5,
};

export function migrateEventLog(log: EventLog): EventLog {
  let currentVersion = log.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > EVENT_LOG_DEFAULT.version) {
    log = resetToLatest(log);
    info(
      `[event-log-migrations] Reset future app settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < EVENT_LOG_DEFAULT.version) {
    try {
      log = migrations[++currentVersion](log);
    } catch (e) {
      error(
        "[event-log-migrations] Couldn't migrate to version " +
          currentVersion +
          '. Backing up configuration and resetting to the latest version. : ' +
          e
      );
      saveBackup(structuredClone(log));
      log = resetToLatest(log);
      currentVersion = log.version;
      message(
        'Your event log data could not to be migrated to the new version of OyasumiVR, and has therefore been reset. Apologies for the inconvenience.\n\nPlease report this issue to the developer so this issue may be fixed in the future. Thank you!',
        { title: 'Migration Error (Event Log)' }
      );
      continue;
    }
    currentVersion = log.version;
    info(`[event-log-migrations] Migrated event log to version ${currentVersion + ''}`);
  }
  return log as EventLog;
}

async function saveBackup(oldData: any) {
  await writeTextFile('event-log.backup.json', JSON.stringify(oldData, null, 2), {
    dir: BaseDirectory.AppData,
  });
}

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

function resetToLatest(data: any): any {
  // Reset to latest
  data = structuredClone(EVENT_LOG_DEFAULT);
  return data;
}
