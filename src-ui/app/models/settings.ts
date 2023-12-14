import { LighthouseDevicePowerState } from './lighthouse-device';

export interface AppSettings {
  version: 8;
  userLanguage: string;
  userLanguagePicked: boolean;
  lighthouseConsolePath: string;
  askForAdminOnStart: boolean;
  exitInSystemTray: boolean;
  startInSystemTray: boolean;
  lighthousePowerControl: boolean;
  lighthousePowerOffState: LighthouseDevicePowerState;
  sleepModeStartupBehaviour: 'PERSIST' | 'ACTIVE' | 'INACTIVE';
  notificationProvider: NotificationProvider;
  notificationsEnabled: { types: NotificationType[] };
  overlayMenuEnabled: boolean;
  overlayGpuFix: boolean;
  overlayMenuOnlyOpenWhenVRChatIsRunning: boolean;
  quitWithSteamVR: QuitWithSteamVRMode;
  generalNotificationVolume: number;
  deviceNicknames: {
    [deviceId: string]: string;
  };
  ignoredLighthouses: string[];
  hotkeys: { [hotkeyId: string]: string[] };
}

export type QuitWithSteamVRMode = 'DISABLED' | 'IMMEDIATELY' | 'AFTERDELAY';

export type HotkeyId =
  | 'HOTKEY_TOGGLE_SLEEP_MODE'
  | 'HOTKEY_ENABLE_SLEEP_MODE'
  | 'HOTKEY_DISABLE_SLEEP_MODE'
  | 'HOTKEY_RUN_SLEEP_PREPARATION'
  | 'HOTKEY_RUN_SHUTDOWN_SEQUENCE'
  | 'HOTKEY_TURN_OFF_CONTROLLER_DEVICES'
  | 'HOTKEY_TURN_OFF_TRACKER_DEVICES'
  | 'HOTKEY_TOGGLE_LIGHTHOUSE_DEVICES'
  | 'HOTKEY_TURN_ON_LIGHTHOUSE_DEVICES'
  | 'HOTKEY_TURN_OFF_LIGHTHOUSE_DEVICES';

export const NotificationTypes = [
  'SLEEP_MODE_ENABLED',
  'SLEEP_MODE_DISABLED',
  'AUTO_UPDATED_STATUS_PLAYERCOUNT',
  'AUTO_ACCEPTED_INVITE_REQUEST',
] as const;

export type NotificationType = (typeof NotificationTypes)[number];

export const APP_SETTINGS_DEFAULT: AppSettings = {
  version: 8,
  userLanguage: 'en',
  userLanguagePicked: false,
  askForAdminOnStart: false,
  lighthouseConsolePath:
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\tools\\lighthouse\\bin\\win64\\lighthouse_console.exe',
  exitInSystemTray: false,
  startInSystemTray: false,
  lighthousePowerControl: true,
  lighthousePowerOffState: 'sleep',
  sleepModeStartupBehaviour: 'PERSIST',
  notificationProvider: 'OYASUMIVR',
  notificationsEnabled: { types: [...NotificationTypes] as NotificationType[] },
  quitWithSteamVR: 'DISABLED',
  overlayMenuEnabled: true,
  overlayGpuFix: false,
  overlayMenuOnlyOpenWhenVRChatIsRunning: false,
  generalNotificationVolume: 100,
  deviceNicknames: {},
  ignoredLighthouses: [],
  hotkeys: {},
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
