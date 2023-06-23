import { LighthouseDevicePowerState } from './lighthouse-device';

export interface AppSettings {
  version: 6;
  userLanguage: string;
  userLanguagePicked: boolean;
  lighthouseConsolePath: string;
  askForAdminOnStart: boolean;
  oscSendingHost: string;
  oscSendingPort: number;
  oscReceivingHost: string;
  oscReceivingPort: number;
  oscEnableExpressionMenu: boolean;
  oscEnableExternalControl: boolean;
  exitInSystemTray: boolean;
  startInSystemTray: boolean;
  lighthousePowerControl: boolean;
  lighthousePowerOffState: LighthouseDevicePowerState;
  sleepModeStartupBehaviour: 'PERSIST' | 'ACTIVE' | 'INACTIVE';
  notificationProvider: NotificationProvider;
  notificationsEnabled: { types: NotificationType[] };
}

export const NotificationTypes = [
  'SLEEP_MODE_ENABLED',
  'SLEEP_MODE_DISABLED',
  'AUTO_UPDATED_STATUS_PLAYERCOUNT',
  'AUTO_ACCEPTED_INVITE_REQUEST',
] as const;

export type NotificationType = (typeof NotificationTypes)[number];

export const APP_SETTINGS_DEFAULT: AppSettings = {
  version: 6,
  userLanguage: 'en',
  userLanguagePicked: false,
  askForAdminOnStart: false,
  lighthouseConsolePath:
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\tools\\lighthouse\\bin\\win64\\lighthouse_console.exe',
  oscSendingHost: '127.0.0.1',
  oscSendingPort: 9000,
  oscReceivingHost: '127.0.0.1',
  oscReceivingPort: 9001,
  oscEnableExpressionMenu: true,
  oscEnableExternalControl: true,
  exitInSystemTray: false,
  startInSystemTray: false,
  lighthousePowerControl: true,
  lighthousePowerOffState: 'sleep',
  sleepModeStartupBehaviour: 'PERSIST',
  notificationProvider: 'OYASUMIVR',
  notificationsEnabled: { types: [...NotificationTypes] as NotificationType[] },
};

export type ExecutableReferenceStatus =
  | 'UNKNOWN'
  | 'CHECKING'
  | 'NOT_FOUND'
  | 'INVALID_EXECUTABLE'
  | 'PERMISSION_DENIED'
  | 'INVALID_FILENAME'
  | 'INVALID_SIGNATURE'
  | 'UNKNOWN_ERROR'
  | 'SUCCESS';

export type NotificationProvider = 'OYASUMIVR' | 'XSOVERLAY' | 'DESKTOP';
