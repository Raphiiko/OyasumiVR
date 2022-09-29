import { Injectable, isDevMode } from '@angular/core';
import { TelemetryManifest } from '../models/telemetry-manifest';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE } from '../globals';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { TELEMETRY_SETTINGS_DEFAULT, TelemetrySettings } from '../models/telemetry-settings';
import { migrateTelemetrySettings } from '../migrations/telemetry-settings.migrations';
import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { cloneDeep } from 'lodash';
import { AppSettingsService } from './app-settings.service';
import { getVersion } from '../utils/app-utils';

export const SETTINGS_KEY_TELEMETRY_SETTINGS = 'TELEMETRY_SETTINGS';

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

  constructor(private http: HttpClient, private appSettings: AppSettingsService) {}

  async init() {
    await this.loadSettings();
    if (!isDevMode()) {
      await this.scheduleTelemetry();
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

  updateSettings(settings: Partial<TelemetrySettings>) {
    const newSettings = Object.assign(cloneDeep(this._settings.value), settings);
    this._settings.next(newSettings);
  }

  async scheduleTelemetry() {
    if (await this.sendTelemetry()) {
      // If successful, schedule next heartbeat in 24 hours
      setInterval(() => this.scheduleTelemetry(), 1000 * 60 * 60 * 24);
    } else {
      // If unsuccessful, schedule next heartbeat in 30 minutes
      setInterval(() => this.scheduleTelemetry(), 1000 * 60 * 30);
    }
  }

  async sendTelemetry(): Promise<boolean> {
    try {
      // Fetch manifest if needed
      if (!this.manifest) {
        await this.fetchManifest();
        if (!this.manifest) return false;
      }
      // Stop if telemetry is not enabled
      if (!this._settings.value.enabled) return false;
      // Stop if last heartbeat was sent less than 24 hours ago
      if (Date.now() - this._settings.value.lastHeartbeat < 1000 * 60 * 60 * 24) return false;
      // Send heartbeat
      let headers = new HttpHeaders();
      Object.entries(this.manifest.v1.heartbeatHeaders).forEach(
        ([key, value]) => (headers = headers.set(key, value))
      );
      const response = await firstValueFrom(
        this.http.post<{ status: string }>(
          this.manifest.v1.heartbeatUrl,
          {
            telemetryId: this._settings.value.telemetryId,
            version: await getVersion(true),
            lang: await firstValueFrom(this.appSettings.settings).then(
              (settings) => settings.userLanguage
            ),
          },
          { headers, observe: 'response' }
        )
      );
      if (response.status !== 200 || response.body?.status !== 'ok') return false;
      // Update last heartbeat
      this._settings.next({ ...this._settings.value, lastHeartbeat: Date.now() });
      await this.saveSettings();
      return true;
    } catch (e) {
      return false;
    }
  }

  async fetchManifest() {
    this.manifest = await firstValueFrom(
      this.http.get<TelemetryManifest>(
        'https://gist.githubusercontent.com/Raphiiko/675fcd03e1e22c2514951ef21c99e4d5/raw/1ba8bc77ab994da8f86f5cf184dd9c79e77f481d/oyasumi_telemetry_manifest.json'
      )
    );
  }
}
