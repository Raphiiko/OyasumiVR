import { Injectable } from '@angular/core';
import { SETTINGS_KEY_THEMING_SETTINGS, SETTINGS_STORE } from '../globals';

type ThemingMode = 'SYSTEM' | 'LIGHT' | 'DARK';

interface ThemingSettings {
  mode: ThemingMode;
}

const THEMING_SETTINGS_DEFAULT: ThemingSettings = {
  mode: 'DARK',
};

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private _settings: ThemingSettings = { ...THEMING_SETTINGS_DEFAULT };
  public get settings(): ThemingSettings {
    return { ...this._settings };
  }

  public async init() {
    await this.loadSettings();
    this.applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this._settings.mode === 'SYSTEM') this.applyTheme();
    });
  }

  public async setMode(mode: ThemingMode): Promise<void> {
    this._settings.mode = mode;
    await this.saveSettings();
    await this.applyTheme();
  }

  private applyTheme() {
    let darkMode: boolean;
    switch (this._settings.mode) {
      case 'SYSTEM':
        darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
        break;
      case 'LIGHT':
        darkMode = false;
        break;
      case 'DARK':
        darkMode = true;
        break;
    }
    if (darkMode) document.body.classList.add('dark');
    else document.body.classList.remove('dark');
  }

  private async loadSettings() {
    const settings: ThemingSettings | undefined = await SETTINGS_STORE.get<ThemingSettings>(
      SETTINGS_KEY_THEMING_SETTINGS
    );
    if (settings) {
      this._settings = { ...settings };
    } else {
      await this.saveSettings();
    }
  }

  private async saveSettings() {
    await SETTINGS_STORE.set(SETTINGS_KEY_THEMING_SETTINGS, this.settings);
    await SETTINGS_STORE.save();
  }
}
