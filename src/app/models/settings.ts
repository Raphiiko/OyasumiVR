export interface AppSettings {
  version: 4;
  userLanguage: string;
  lighthouseConsolePath: string;
  askForAdminOnStart: boolean;
  oscSendingHost: string;
  oscSendingPort: number;
  oscReceivingHost: string;
  oscReceivingPort: number;
  enableDesktopNotifications: boolean;
  enableXSOverlayNotifications: boolean;
  enableTrayExit: boolean;
}

export const APP_SETTINGS_DEFAULT: AppSettings = {
  version: 4,
  userLanguage: 'en',
  askForAdminOnStart: false,
  lighthouseConsolePath:
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\tools\\lighthouse\\bin\\win64\\lighthouse_console.exe',
  oscSendingHost: '127.0.0.1',
  oscSendingPort: 9000,
  oscReceivingHost: '127.0.0.1',
  oscReceivingPort: 9001,
  enableXSOverlayNotifications: false,
  enableDesktopNotifications: false,
  enableTrayExit: false,
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
