import { Injectable, Injector } from '@angular/core';
import { SETTINGS_KEY_TELEMETRY_SETTINGS, SETTINGS_STORE } from '../../globals';
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
import { TELEMETRY_SETTINGS_DEFAULT, TelemetrySettings } from '../../models/telemetry-settings';

import { commands } from 'src-ui/app/bindings';
import { isEqual } from 'lodash';
import { FeatureSnapshotService } from './feature-snapshot.service';

@Injectable({
  providedIn: 'root',
})
export class TelemetryService {
  private _settings: BehaviorSubject<TelemetrySettings> = new BehaviorSubject<TelemetrySettings>(
    TELEMETRY_SETTINGS_DEFAULT
  );
  public settings: Observable<TelemetrySettings> = this._settings.asObservable();

  constructor(private injector: Injector) {}

  async init() {
    await this.loadSettings();
    // the core rejects events until it is enabled, and the throttled sync below waits 2 seconds
    await commands.setTelemetryEnabled(this._settings.value.enabled);
    // resolved lazily: its dependencies are not initialized yet, and some of them use this service
    this.injector.get(FeatureSnapshotService).init();
    this.settings
      .pipe(
        map((settings) => settings.enabled),
        distinctUntilChanged(),
        throttleTime(2000, asyncScheduler, { leading: false, trailing: true }),
        distinctUntilChanged(),
        switchMap(async (enable) => {
          await commands.setTelemetryEnabled(enable);
        })
      )
      .subscribe();

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
    const settings: TelemetrySettings | undefined = await SETTINGS_STORE.get<TelemetrySettings>(
      SETTINGS_KEY_TELEMETRY_SETTINGS
    );
    this._settings.next(settings ?? this._settings.value);
  }

  async saveSettings() {
    await SETTINGS_STORE.set(SETTINGS_KEY_TELEMETRY_SETTINGS, this._settings.value);
  }

  async updateSettings(settings: Partial<TelemetrySettings>) {
    const newSettings = Object.assign(structuredClone(this._settings.value), settings);
    this._settings.next(newSettings);
    await this.saveSettings();
  }

  /** Returns at once; a failed send is dropped. */
  async trackEvent(event: string, props: { [key: string]: string | number }) {
    if (!this._settings.value.enabled) return;
    void this.send(event, props);
  }

  /** Resolves to whether the core sent the event. Never rejects. */
  private async send(event: string, props: { [key: string]: string | number }): Promise<boolean> {
    const result = await commands.trackEvent(event, props);
    return result.status === 'ok';
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
    const lastEvent = this._settings.value.reportingCache.find((e) => e.event === event);
    // If the event is in the cache and the timeout has not expired, and the value has not changed, do not track it
    if (lastEvent && now - lastEvent.timestamp < lastEvent.timeout) {
      if (!allowValueOverride || lastEvent.lastValue === propString) return;
    }
    // only a sent event enters the cache, so a failed send is retried on the next call
    if (!(await this.send(event, props))) return;
    // read the cache again: other throttled events may have updated it during the await
    const reportingCache = this._settings.value.reportingCache.filter((e) => e.event !== event);
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
