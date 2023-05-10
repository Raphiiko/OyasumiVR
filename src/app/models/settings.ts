export interface AppSettings {
  version: 5;
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
  enableDesktopNotifications: boolean;
  enableXSOverlayNotifications: boolean;
}

export const APP_SETTINGS_DEFAULT: AppSettings = {
  version: 5,
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
  enableXSOverlayNotifications: false,
  enableDesktopNotifications: false,
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
