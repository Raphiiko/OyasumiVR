export interface AppSettings {
  version: 2;
  userLanguage: string;
  lighthouseConsolePath: string;
  askForAdminOnStart: boolean;
}

export const APP_SETTINGS_DEFAULT: AppSettings = {
  version: 2,
  userLanguage: 'en',
  askForAdminOnStart: false,
  lighthouseConsolePath:
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\tools\\lighthouse\\bin\\win64\\lighthouse_console.exe',
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
