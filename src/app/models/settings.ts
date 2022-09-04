import { AppSettingsService } from '../services/app-settings.service';

export interface AppSettings {
  version: 1;
  userLanguage: string;
  lighthouseConsolePath: string;
}

export const APP_SETTINGS_DEFAULT: AppSettings = {
  version: 1,
  userLanguage: 'en',
  lighthouseConsolePath:
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\tools\\lighthouse\\bin\\win64\\lighthouse_console.exe',
};
