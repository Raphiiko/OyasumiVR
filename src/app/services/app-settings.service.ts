import { Injectable } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import { asyncScheduler, BehaviorSubject, Observable, skip, switchMap, throttleTime } from 'rxjs';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE } from '../globals';
import { cloneDeep } from 'lodash';
import { migrateAppSettings } from '../migrations/app-settings.migrations';

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
  private _loadedDefaults: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  loadedDefaults: Observable<boolean> = this._loadedDefaults.asObservable();

  constructor() {}

  async init() {
    await this.loadSettings();
    this.settings
      .pipe(
        skip(1),
        throttleTime(500, asyncScheduler, { leading: false, trailing: true }),
        switchMap(() => this.saveSettings())
      )
      .subscribe();
  }

  async loadSettings() {
    let settings: AppSettings | null = await this.store.get<AppSettings>(SETTINGS_KEY_APP_SETTINGS);
    let loadedDefaults = false;
    if (settings) {
      settings = migrateAppSettings(settings);
    } else {
      settings = this._settings.value;
      loadedDefaults = true;
    }
    this._settings.next(settings);
    await this.saveSettings();
    if (loadedDefaults) this._loadedDefaults.next(true);
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
