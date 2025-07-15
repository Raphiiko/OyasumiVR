import { Injectable } from '@angular/core';
import { SETTINGS_KEY_TELEMETRY_SETTINGS, SETTINGS_STORE } from '../globals';
import {
  asyncScheduler,
  BehaviorSubject,
  distinctUntilChanged,
  interval,
  map,
  Observable,
  startWith,
  switchMap,
  throttleTime,
} from 'rxjs';
import { TELEMETRY_SETTINGS_DEFAULT, TelemetrySettings } from '../models/telemetry-settings';
import { migrateTelemetrySettings } from '../migrations/telemetry-settings.migrations';

import { invoke } from '@tauri-apps/api/core';
import { trackEvent } from '@aptabase/tauri';
import { isEqual } from 'lodash';

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

    // Clean up the reporting cache
    interval(60000)
      .pipe(startWith(null))
      .subscribe(() => {
        const reportingCache = this._settings.value.reportingCache.filter(
          (e) => Date.now() - e.timestamp < e.timeout
        );
        if (isEqual(reportingCache, this._settings.value.reportingCache)) return;
        this._settings.next({
          ...this._settings.value,
          reportingCache,
        });
        this.saveSettings();
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

  async trackThrottledEvent(
    event: string,
    props: { [key: string]: string | number },
    timeout: number,
    allowValueOverride: boolean = false
  ) {
    if (!this._settings.value.enabled) return;
    const now = Date.now();
    const propString = JSON.stringify(props);
    const reportingCache = structuredClone(this._settings.value.reportingCache);
    const lastEvent = reportingCache.find((e) => e.event === event);
    // If the event is in the cache and the timeout has not expired, and the value has not changed, do not track it
    if (lastEvent && now - lastEvent.timestamp < lastEvent.timeout) {
      if (!allowValueOverride || lastEvent.lastValue === propString) return;
    }
    // Track the event
    await this.trackEvent(event, props);
    // Remove the event from the cache if it already exists
    if (lastEvent) reportingCache.splice(reportingCache.indexOf(lastEvent), 1);
    // Add the event to the cache
    reportingCache.push({
      event,
      timestamp: now,
      lastValue: propString,
      timeout,
    });
    // Save the new cache
    this._settings.next({
      ...this._settings.value,
      reportingCache,
    });
    await this.saveSettings();
  }
}
