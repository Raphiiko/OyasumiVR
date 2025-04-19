import { Injectable } from '@angular/core';
import { SETTINGS_KEY_TELEMETRY_SETTINGS, SETTINGS_STORE } from '../globals';
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

import { invoke } from '@tauri-apps/api/core';
import { trackEvent } from '@aptabase/tauri';

@Injectable({
  providedIn: 'root',
})
export class TelemetryService {
  private _settings: BehaviorSubject<TelemetrySettings> = new BehaviorSubject<TelemetrySettings>(
    TELEMETRY_SETTINGS_DEFAULT
  );
  public settings: Observable<TelemetrySettings> = this._settings.asObservable();

  private trackedJSErrors: string[] = [];

  constructor() {}

  async init() {
    await this.loadSettings();
    this.settings
      .pipe(
        map((settings) => settings.enabled),
        distinctUntilChanged(),
        throttleTime(2000, asyncScheduler, { leading: false, trailing: true }),
        distinctUntilChanged(),
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
      const errorData = JSON.stringify({
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        message: e.message,
      });
      if (this.trackedJSErrors.includes(errorData)) return;
      this.trackedJSErrors.push(errorData);
      this.trackEvent('ui_js_error', {
        errorData,
      });
    });
  }

  async loadSettings() {
    let settings: TelemetrySettings | undefined = await SETTINGS_STORE.get<TelemetrySettings>(
      SETTINGS_KEY_TELEMETRY_SETTINGS
    );
    settings = settings ? migrateTelemetrySettings(settings) : this._settings.value;
    this._settings.next(settings);
    await this.saveSettings();
  }

  async saveSettings() {
    await SETTINGS_STORE.set(SETTINGS_KEY_TELEMETRY_SETTINGS, this._settings.value);
    await SETTINGS_STORE.save();
  }

  async updateSettings(settings: Partial<TelemetrySettings>) {
    const newSettings = Object.assign(structuredClone(this._settings.value), settings);
    this._settings.next(newSettings);
    await this.saveSettings();
  }

  async trackEvent(event: string, props: { [key: string]: string | number }) {
    if (!this._settings.value.enabled) return;
    await trackEvent(event, props);
  }
}
