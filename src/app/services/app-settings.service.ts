import { Injectable } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import { asyncScheduler, BehaviorSubject, Observable, skip, switchMap, throttleTime } from 'rxjs';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE, SETTINGS_KEY_APP_SETTINGS } from '../globals';
import { cloneDeep } from 'lodash';
import { migrateAppSettings } from '../migrations/app-settings.migrations';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class AppSettingsService {
  private store = new Store(SETTINGS_FILE);
  private _settings: BehaviorSubject<AppSettings> = new BehaviorSubject<AppSettings>(
    APP_SETTINGS_DEFAULT
  );
  settings: Observable<AppSettings> = this._settings.asObservable();
  private _loadedDefaults: BehaviorSubject<boolean | undefined> = new BehaviorSubject<
    boolean | undefined
  >(undefined);
  loadedDefaults: Observable<boolean | undefined> = this._loadedDefaults.asObservable();

  constructor(private translateService: TranslateService) {}

  async init() {
    await this.loadSettings();
    this.settings
      .pipe(
        skip(1),
        throttleTime(500, asyncScheduler, { leading: true, trailing: true }),
        switchMap(() => this.saveSettings())
      )
      .subscribe();
  }

  async loadSettings() {
    let settings: AppSettings | null = await this.store.get<AppSettings>(SETTINGS_KEY_APP_SETTINGS);
    let loadedDefaults = false;
    if (settings) {
      const oldSettings = cloneDeep(settings);
      settings = migrateAppSettings(settings);
      if (oldSettings.userLanguage !== settings.userLanguage) {
        this.translateService.use(settings.userLanguage);
      }
    } else {
      settings = this._settings.value;
      loadedDefaults = true;
    }
    this._settings.next(settings);
    await this.saveSettings();
    this._loadedDefaults.next(loadedDefaults);
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
