import { APP_SETTINGS_DEFAULT } from '../models/settings';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import { VRCHAT_API_SETTINGS_DEFAULT } from '../models/vrchat-api-settings';
import { DEVICE_MANAGER_DATA_DEFAULT } from '../models/device-manager';
import { TELEMETRY_SETTINGS_DEFAULT } from '../models/telemetry-settings';
import { PULSOID_API_SETTINGS_DEFAULT } from '../models/pulsoid-api-settings';
import { EVENT_LOG_DEFAULT } from '../models/event-log-entry';
import { APP_SETTINGS_MIGRATION } from './app-settings.migrations';
import { AUTOMATION_CONFIGS_MIGRATION } from './automation-configs.migrations';
import { VRCHAT_API_MIGRATION } from './vrchat-api-settings.migrations';
import { DEVICE_MANAGER_MIGRATION } from './device-manager.migrations';
import { TELEMETRY_SETTINGS_MIGRATION } from './telemetry-settings.migrations';
import { PULSOID_API_MIGRATION } from './pulsoid-api-settings.migrations';
import { EVENT_LOG_MIGRATION } from './event-log.migrations';
import type { StoreMigrationSpec } from 'src-shared-ts/src/store-migration';

export const SETTINGS_STORE_MIGRATION: StoreMigrationSpec = {
  storeName: 'settings',
  migrations: {
    APP_SETTINGS: APP_SETTINGS_MIGRATION,
    AUTOMATION_CONFIGS: AUTOMATION_CONFIGS_MIGRATION,
    VRCHAT_API: VRCHAT_API_MIGRATION,
    DEVICE_MANAGER: DEVICE_MANAGER_MIGRATION,
    TELEMETRY_SETTINGS: TELEMETRY_SETTINGS_MIGRATION,
    PULSOID_API: PULSOID_API_MIGRATION,
  },
  defaults: {
    APP_SETTINGS: APP_SETTINGS_DEFAULT,
    AUTOMATION_CONFIGS: AUTOMATION_CONFIGS_DEFAULT,
    VRCHAT_API: VRCHAT_API_SETTINGS_DEFAULT,
    DEVICE_MANAGER: DEVICE_MANAGER_DATA_DEFAULT,
    TELEMETRY_SETTINGS: TELEMETRY_SETTINGS_DEFAULT,
    PULSOID_API: PULSOID_API_SETTINGS_DEFAULT,
  },
};

export const EVENT_LOG_STORE_MIGRATION: StoreMigrationSpec = {
  storeName: 'event_log',
  migrations: {
    EVENT_LOG: EVENT_LOG_MIGRATION,
  },
  defaults: {
    EVENT_LOG: EVENT_LOG_DEFAULT,
  },
};

export const STORE_MIGRATIONS: StoreMigrationSpec[] = [
  SETTINGS_STORE_MIGRATION,
  EVENT_LOG_STORE_MIGRATION,
];
