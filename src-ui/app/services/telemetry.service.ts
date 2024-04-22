import { Injectable } from '@angular/core';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE, SETTINGS_KEY_TELEMETRY_SETTINGS } from '../globals';
import {
  asyncScheduler,
  BehaviorSubject,
  distinctUntilChanged,
  map,
  Observable,
  switchMap,
  throttleTime,
} from 'rxjs';
import { TELEMETRY_SETTINGS_DEFAULT, TelemetrySettings } from '../models/telemetry-settings';
import { migrateTelemetrySettings } from '../migrations/telemetry-settings.migrations';
import { cloneDeep } from 'lodash';
import { invoke } from '@tauri-apps/api';
import { trackEvent } from '@aptabase/tauri';

@Injectable({
  providedIn: 'root',
})
export class TelemetryService {
  private store = new Store(SETTINGS_FILE);
  private _settings: BehaviorSubject<TelemetrySettings> = new BehaviorSubject<TelemetrySettings>(
    TELEMETRY_SETTINGS_DEFAULT
  );
  public settings: Observable<TelemetrySettings> = this._settings.asObservable();

  constructor() {}

  async init() {
    await this.loadSettings();
    this.settings
      .pipe(
        map((settings) => settings.enabled),
        distinctUntilChanged(),
        throttleTime(2000, asyncScheduler, { leading: false, trailing: true }),
        switchMap(async (enable) => {
          await invoke('set_telemetry_enabled', { enable });
        })
      )
      .subscribe();

    addEventListener('unhandledrejection', (e) => {
      this.trackEvent('ui_promise_rejected', {
        message: (e.reason?.message || e.reason || e).toString(),
      });
    });

    window.addEventListener('error', (e) => {
      this.trackEvent('ui_js_error', {
        message: e.message,
      });
    });
  }

  async loadSettings() {
    let settings: TelemetrySettings | null = await this.store.get<TelemetrySettings>(
      SETTINGS_KEY_TELEMETRY_SETTINGS
    );
    settings = settings ? migrateTelemetrySettings(settings) : this._settings.value;
    this._settings.next(settings);
    await this.saveSettings();
  }

  async saveSettings() {
    await this.store.set(SETTINGS_KEY_TELEMETRY_SETTINGS, this._settings.value);
    await this.store.save();
  }

  async updateSettings(settings: Partial<TelemetrySettings>) {
    const newSettings = Object.assign(cloneDeep(this._settings.value), settings);
    this._settings.next(newSettings);
    await this.saveSettings();
  }

  async trackEvent(event: string, props: { [key: string]: string | number }) {
    if (!this._settings.value.enabled) return;
    await trackEvent(event, props);
  }
}
