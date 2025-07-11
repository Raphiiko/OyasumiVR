import { Injectable } from '@angular/core';
import {
  PULSOID_CLIENT_ID,
  PULSOID_REDIRECT_URI,
  SETTINGS_KEY_PULSOID_API,
  SETTINGS_STORE,
} from '../../globals';
import { ModalService } from '../modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../components/confirm-modal/confirm-modal.component';
import { error, info, warn } from '@tauri-apps/plugin-log';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  interval,
  map,
  Observable,
  of,
  switchMap,
  timeout,
} from 'rxjs';
import { fetch } from '@tauri-apps/plugin-http';

import {
  PULSOID_API_SETTINGS_DEFAULT,
  PulsoidApiSettings,
} from '../../models/pulsoid-api-settings';
import { migratePulsoidApiSettings } from '../../migrations/pulsoid-api-settings.migrations';
import * as shell from '@tauri-apps/plugin-shell';

const HISTORY_LENGTH = 1000 * 60 * 60 * 12; // 12 hours

interface PulsoidTokenSet {
  access_token: string;
  expires_in: number;
}

interface PulsoidProfile {
  channel: string;
  username: string;
  mobile_login: boolean;
  heart_rate: boolean;
}

interface PulsoidMessage {
  measured_at: number;
  data: {
    heart_rate: number;
  };
}

export type HeartbeatRecord = [number, number]; // [timestamp, heartRate]

@Injectable({
  providedIn: 'root',
})
export class PulsoidService {
  private csrfCache: string[] = [];
  private settings = new BehaviorSubject<PulsoidApiSettings>(PULSOID_API_SETTINGS_DEFAULT);
  private socket?: WebSocket;
  private _heartRate = new BehaviorSubject<number>(0);
  private _lastReport = new BehaviorSubject<number>(0);
  private _heartbeatRecords = new BehaviorSubject<HeartbeatRecord[]>([]);
  public heartbeatRecords = this._heartbeatRecords.asObservable();

  public heartRate = this._heartRate.pipe(
    switchMap(() => this._heartRate.pipe(timeout({ each: 10000, with: () => of(null) })))
  );
  public heartRateLastReported = this._lastReport.asObservable();
  public loggedInUser = this.settings.pipe(
    map((settings) => {
      if (!settings.accessToken || !settings.expiresAt) return null;
      return settings.username ?? null;
    })
  );

  constructor(private modalService: ModalService) {}

  async init() {
    await this.loadSettings();
    await this.manageSocketConnection();
    this.heartRate.pipe(filter(Boolean)).subscribe((heartRate) => {
      const records = this._heartbeatRecords.value;
      records.push([Date.now(), heartRate]);
      this._heartbeatRecords.next(records);
    });
    interval(1000 * 60 * 60).subscribe(() => {
      const records = this._heartbeatRecords.value;
      // Remove all records older than HISTORY_LENGTH
      const now = Date.now();
      let modified = false;
      while (records.length > 0 && records[0][0] < now - HISTORY_LENGTH) {
        records.shift();
        modified = true;
      }
      if (modified) this._heartbeatRecords.next(records);
    });
  }

  public async logout() {
    await this.setActiveTokenSet(null);
  }

  public async login() {
    await shell.open(this.getLoginUrl());
  }

  public getLoginUrl(): string {
    // Generate CSRF token
    const state = Math.random().toString(36).substring(7);
    this.csrfCache.push(state);
    // Remove CSRF token from cache after 1 hour
    setTimeout(
      () => {
        const index = this.csrfCache.indexOf(state);
        if (index > -1) this.csrfCache.splice(index, 1);
      },
      1000 * 60 * 60
    );
    // Construct a url with query parameters
    const url = new URL('https://pulsoid.net/oauth2/authorize');
    url.searchParams.append('client_id', PULSOID_CLIENT_ID);
    url.searchParams.append('redirect_uri', PULSOID_REDIRECT_URI);
    url.searchParams.append('response_type', 'token');
    url.searchParams.append('scope', 'data:heart_rate:read,profile:read');
    url.searchParams.append('state', state);
    return url.toString();
  }

  public async handleDeepLink(
    path: string,
    params: Record<string, string[]>,
    fragmentParams: Record<string, string[]>
  ) {
    // Validate response
    let errorOccurred = false;
    let errorCode: string | undefined;
    let errorDescription: string | undefined;
    if (params['error']) {
      errorOccurred = true;
      errorCode = params['error'][0];
      errorDescription = params['error_description']
        ? params['error_description'][0].replace(/\+/g, ' ')
        : undefined;
      error(
        `[PulsoidService] Pulsoid login failed, received error response: ${errorDescription} (${errorCode})`
      );
    } else if (!fragmentParams['state'] || !this.csrfCache.includes(fragmentParams['state'][0])) {
      errorOccurred = true;
      error(`[PulsoidService] Pulsoid login failed, csrf check failed: ${fragmentParams['state']}`);
    } else if (!fragmentParams['access_token']) {
      errorOccurred = true;
      error(`[PulsoidService] Pulsoid login failed, no access token received`);
    } else if (!fragmentParams['expires_in']) {
      errorOccurred = true;
      error(`[PulsoidService] Pulsoid login failed, no token expiry received`);
    }
    if (!errorOccurred) {
      // Save token set
      const tokenSet: PulsoidTokenSet = {
        access_token: fragmentParams['access_token'][0],
        expires_in: parseInt(fragmentParams['expires_in'][0]),
      };
      await this.setActiveTokenSet(tokenSet);
      // Fetch the profile
      let profile: PulsoidProfile | undefined;
      try {
        profile = await firstValueFrom(this.getProfile());
      } catch (e) {
        errorOccurred = true;
        error(`[PulsoidService] Pulsoid login failed, could not fetch profile: ${e}`);
        await this.setActiveTokenSet(null);
      }
      // Save the active profile
      if (profile) {
        await this.setActiveProfile(profile);
        return;
      }
    }
    // If a validation error occurred, stop here and inform the user.
    if (errorOccurred) {
      this.modalService
        .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
          title: 'pulsoid.login.error.title',
          message: {
            string: 'pulsoid.login.error.message',
            values: {
              errorDetails: errorDescription
                ? `Pulsoid: ${errorDescription} (${errorCode})`
                : errorCode
                  ? `Pulsoid: ${errorCode}`
                  : '',
            },
          },
          confirmButtonText: 'Ok',
          showCancel: false,
        })
        .subscribe();
    }
  }

  private async setActiveTokenSet(tokenSet: PulsoidTokenSet | null) {
    const newSettings = structuredClone(this.settings.value);
    newSettings.accessToken = tokenSet?.access_token ?? undefined;
    newSettings.expiresAt = tokenSet
      ? Math.floor(Date.now() / 1000) + tokenSet!.expires_in
      : undefined;
    this.settings.next(newSettings);
    await this.setActiveProfile(null);
  }

  private async setActiveProfile(profile: PulsoidProfile | null) {
    const newSettings = structuredClone(this.settings.value);
    newSettings.username = profile?.username ?? undefined;
    this.settings.next(newSettings);
    await this.saveSettings();
  }

  private getProfile(): Observable<PulsoidProfile> {
    if (!this.settings.value.accessToken) throw new Error('No token set available');
    return this.getApiUrl('profile').pipe(
      switchMap((url) =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${this.settings.value?.accessToken}`,
          },
        })
      ),
      // If response was not successful, throw an error
      map((response) => {
        if (!response.ok) throw response;
        return response;
      }),
      switchMap((response) => response.json() as Promise<PulsoidProfile>)
    );
  }

  private getApiUrl(route: string, apiVersion = 'v1'): Observable<string> {
    if (!route.startsWith('/')) route = '/' + route;
    return of(`https://dev.pulsoid.net/api/${apiVersion}${route}`);
  }

  private async loadSettings() {
    let settings: PulsoidApiSettings | undefined =
      await SETTINGS_STORE.get<PulsoidApiSettings>(SETTINGS_KEY_PULSOID_API);
    settings = settings ? migratePulsoidApiSettings(settings) : this.settings.value;
    // Handle token expiry
    if (settings.expiresAt && settings.expiresAt < Date.now() / 1000) {
      info('[Pulsoid] Token expired, throwing it away.');
      settings.accessToken = undefined;
      settings.expiresAt = undefined;
      // TODO: Let user in some way know that their existing login has expired, and they should reauthenticate
    }
    // Finish loading settings & write changes to disk
    this.settings.next(settings);
    await this.saveSettings();
  }

  private async updateSettings(settings: Partial<PulsoidApiSettings>) {
    const newSettings = Object.assign(structuredClone(this.settings.value), settings);
    this.settings.next(newSettings);
    await this.saveSettings();
  }

  private async saveSettings() {
    await SETTINGS_STORE.set(SETTINGS_KEY_PULSOID_API, this.settings.value);
  }

  private async manageSocketConnection() {
    const buildSocket = () => {
      if (this.socket) {
        try {
          this.socket.close();
        } catch {
          // Ignore any error, we just want to disconnect
        }
        this.socket = undefined;
      }
      this.socket = new WebSocket(
        'wss://dev.pulsoid.net/api/v1/data/real_time?access_token=' +
          this.settings.value.accessToken
      );
      this.socket.onopen = () => this.onSocketEvent('OPEN');
      this.socket.onerror = () => this.onSocketEvent('ERROR');
      this.socket.onclose = () => this.onSocketEvent('CLOSE');
      this.socket.onmessage = (message) => this.onSocketEvent('MESSAGE', message);
    };
    // Connect and disconnect based on login status
    this.settings
      .pipe(
        map((settings) => settings.accessToken),
        distinctUntilChanged()
      )
      .subscribe((accessToken) => {
        if (accessToken) {
          buildSocket();
        } else {
          if (this.socket) {
            try {
              this.socket.close();
            } catch {
              // Ignore any error, we just want to disconnect
            }
            this.socket = undefined;
          }
        }
      });
    // Check connection intermittently in case of dropouts
    interval(10000)
      .pipe(filter(() => !!this.settings.value.accessToken))
      .subscribe(() => {
        // Stop if we have an active connection
        if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
        // (Re)build a connection
        buildSocket();
      });
  }

  private async onSocketEvent(
    event: 'OPEN' | 'CLOSE' | 'ERROR' | 'MESSAGE',
    message?: MessageEvent
  ) {
    switch (event) {
      case 'OPEN':
        info(`[Pulsoid] Websocket connection opened`);
        return;
      case 'CLOSE':
        info(`[Pulsoid] Websocket connection closed`);
        return;
      case 'ERROR':
        error(`[Pulsoid] Websocket connection error: ${JSON.stringify(message)}`);
        return;
      case 'MESSAGE':
        break;
    }
    if (event !== 'MESSAGE') return;
    await this.parseSocketMessage(message?.data);
  }

  private async parseSocketMessage(messageData: string) {
    let message: PulsoidMessage;
    try {
      message = JSON.parse(messageData);
    } catch {
      warn('[Pulsoid] Could not parse socket message: ' + messageData);
      return;
    }
    this._lastReport.next(Date.now());
    this._heartRate.next(message.data.heart_rate);
  }
}
