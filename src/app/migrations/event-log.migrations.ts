import { info } from 'tauri-plugin-log-api';
import { cloneDeep } from 'lodash';
import { EVENT_LOG_DEFAULT, EventLog } from '../models/event-log-entry';

const migrations: { [v: number]: (data: any) => any } = {
  1: toLatest,
};

export function migrateEventLog(log: EventLog): EventLog {
  let currentVersion = log.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > EVENT_LOG_DEFAULT.version) {
    log = toLatest(log);
    info(
      `[app-settings-migrations] Reset future app settings version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < EVENT_LOG_DEFAULT.version) {
    log = migrations[++currentVersion](log);
    currentVersion = log.version;
    info(`[event-log-migrations] Migrated event log to version ${currentVersion + ''}`);
  }
  return log as EventLog;
}

function toLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(EVENT_LOG_DEFAULT);
  return data;
}
