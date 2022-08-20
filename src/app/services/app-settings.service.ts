import { Injectable } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import { asyncScheduler, BehaviorSubject, Observable, skip, switchMap, throttleTime } from 'rxjs';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE } from '../globals';
import { AutomationConfig, AutomationConfigs, AutomationType } from '../models/automations';
import { cloneDeep } from 'lodash';

export const SETTINGS_KEY_APP_SETTINGS = 'APP_SETTINGS';

@Injectable({
  providedIn: 'root',
})
export class AppSettingsService {
  private store = new Store(SETTINGS_FILE);
  private _settings: BehaviorSubject<AppSettings> = new BehaviorSubject<AppSettings>(
    APP_SETTINGS_DEFAULT
  );
  settings: Observable<AppSettings> = this._settings.asObservable();

  constructor() {
    this.init();
  }

  async init() {
    await this.loadConfigs();
    this.settings
      .pipe(
        skip(1),
        throttleTime(500, asyncScheduler, { leading: false, trailing: true }),
        switchMap(() => this.saveSettings())
      )
      .subscribe();
  }

  async loadConfigs() {
    let settings: AppSettings | null = await this.store.get<AppSettings>(
      SETTINGS_KEY_APP_SETTINGS
    );
    if (!settings) {
      await this.saveSettings();
      this._settings.next(this._settings.value);
    } else {
      settings = Object.assign({}, cloneDeep(this._settings.value), settings);
      this._settings.next(settings);
    }
  }

  async saveSettings() {
    await this.store.set(SETTINGS_KEY_APP_SETTINGS, this._settings.value);
    await this.store.save();
  }

  updateSettings(settings: Partial<AppSettings>) {
    const newSettings = Object.assign(cloneDeep(this._settings.value), settings);
    this._settings.next(newSettings);
  }
}
