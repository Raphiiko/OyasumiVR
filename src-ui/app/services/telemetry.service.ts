import { Injectable, isDevMode } from '@angular/core';
import { TelemetryManifest } from '../models/telemetry-manifest';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE, SETTINGS_KEY_TELEMETRY_SETTINGS } from '../globals';
import {
  asyncScheduler,
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  Observable,
  pairwise,
  switchMap,
  throttleTime,
} from 'rxjs';
import { TELEMETRY_SETTINGS_DEFAULT, TelemetrySettings } from '../models/telemetry-settings';
import { migrateTelemetrySettings } from '../migrations/telemetry-settings.migrations';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { cloneDeep } from 'lodash';
import { AppSettingsService } from './app-settings.service';
import { getVersion } from '../utils/app-utils';
import { debug, info } from 'tauri-plugin-log-api';
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
  private manifest?: TelemetryManifest;
  private timeout?: NodeJS.Timeout;

  constructor(private http: HttpClient, private appSettings: AppSettingsService) {}

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
    if (!isDevMode()) {
      this.timeout = setTimeout(() => this.scheduleTelemetry(), 10000);
      // Send heartbeat when language setting has changed
      this.appSettings.settings
        .pipe(
          map((settings) => settings.userLanguage),
          pairwise(),
          filter(([oldLang, newLang]) => oldLang !== newLang),
          debounceTime(20000)
        )
        .subscribe(() => this.scheduleTelemetry());
    } else {
      debug('[Telemetry] Disabling telemetry in dev mode');
    }
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

  async scheduleTelemetry() {
    if (this.timeout) clearTimeout(this.timeout);
    if (await this.sendTelemetry()) {
      // If successful, schedule next heartbeat in 24 hours
      this.timeout = setTimeout(() => this.scheduleTelemetry(), 1000 * 60 * 60 * 24);
    } else {
      // If unsuccessful, schedule next heartbeat in 30 minutes
      this.timeout = setTimeout(() => this.scheduleTelemetry(), 1000 * 60 * 30);
    }
  }

  async sendTelemetry(): Promise<boolean> {
    try {
      const settings = this._settings.value;
      // Stop if telemetry is not enabled
      if (!settings.enabled) return false;
      // Fetch manifest if needed
      if (!this.manifest) {
        await this.fetchManifest();
        if (!this.manifest) return false;
      }
      // Determine version and language to send
      const version = await getVersion();
      const lang = await firstValueFrom(this.appSettings.settings).then(
        (settings) => settings.userLanguage
      );
      // Stop if last heartbeat was sent less than 24 hours ago for the same version and language
      if (
        settings.lastVersion === version &&
        settings.lastLang === lang &&
        Date.now() - this._settings.value.lastHeartbeat < 1000 * 60 * 60 * 24
      )
        return false;
      // Send heartbeat
      let headers = new HttpHeaders();
      Object.entries(this.manifest.v1.heartbeatHeaders).forEach(
        ([key, value]) => (headers = headers.set(key, value))
      );
      info(
        '[Telemetry] Sending heartbeat (id=' +
          settings.telemetryId +
          ',version=' +
          version +
          ', lang=' +
          lang +
          ')'
      );
      const response = await firstValueFrom(
        this.http.post<{ status: string }>(
          this.manifest.v1.heartbeatUrl,
          {
            telemetryId: settings.telemetryId,
            version,
            lang,
          },
          { headers, observe: 'response' }
        )
      );
      if (response.status !== 200 || response.body?.status !== 'ok') return false;
      // Update last heartbeat
      this._settings.next({
        ...settings,
        lastHeartbeat: Date.now(),
        lastVersion: version,
        lastLang: lang,
      });
      await this.saveSettings();
      return true;
    } catch (e) {
      return false;
    }
  }

  async fetchManifest() {
    info('[Telemetry] Fetching manifest');
    this.manifest = await firstValueFrom(
      this.http.get<TelemetryManifest>(
        'https://gist.githubusercontent.com/Raphiiko/675fcd03e1e22c2514951ef21c99e4d5/raw/1ba8bc77ab994da8f86f5cf184dd9c79e77f481d/oyasumi_telemetry_manifest.json'
      )
    );
  }

  async trackEvent(event: string, props: { [key: string]: string | number }) {
    if (!this._settings.value.enabled) return;
    await trackEvent(event, props);
  }
}
