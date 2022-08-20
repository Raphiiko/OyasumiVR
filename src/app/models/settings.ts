export interface AppSettings {
  userLanguage: string;
  lighthouseConsolePath: string;
}

export const APP_SETTINGS_DEFAULT = {
  userLanguage: 'en',
  lighthouseConsolePath:
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\tools\\lighthouse\\bin\\win64\\lighthouse_console.exe',
};
