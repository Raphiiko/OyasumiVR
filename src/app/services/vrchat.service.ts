import { Injectable } from '@angular/core';
import { Body, Client, getClient, Response, ResponseType } from '@tauri-apps/api/http';
import { APIConfig, CurrentUser, UserStatus, Notification, NotificationType } from 'vrchat/dist';
import { parse as parseSetCookieHeader } from 'set-cookie-parser';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE } from '../globals';
import { VRCHAT_API_SETTINGS_DEFAULT, VRChatApiSettings } from '../models/vrchat-api-settings';
import { migrateVRChatApiSettings } from '../migrations/vrchat-api-settings.migrations';
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  filter,
  interval,
  map,
  Observable,
} from 'rxjs';
import { cloneDeep } from 'lodash';
import { serialize as serializeCookie } from 'cookie';
import { getVersion } from '../utils/app-utils';
import { VRChatEventHandlerManager } from './vrchat-events/vrchat-event-handler';
import { VRChatLoginModalComponent } from '../components/vrchat-login-modal/vrchat-login-modal.component';
import { SimpleModalService } from 'ngx-simple-modal';
import { TaskQueue } from '../utils/task-queue';
import { WorldContext } from '../models/vrchat';
import { VRChatLogService } from './vrchat-log.service';

const BASE_URL = 'https://api.vrchat.cloud/api/1';
const SETTINGS_KEY_VRCHAT_API = 'VRCHAT_API';
export type VRChatServiceStatus = 'PRE_INIT' | 'ERROR' | 'LOGGED_OUT' | 'LOGGED_IN';

@Injectable({
  providedIn: 'root',
})
export class VRChatService {
  private http!: Client;
  private store = new Store(SETTINGS_FILE);
  private settings: BehaviorSubject<VRChatApiSettings> = new BehaviorSubject<VRChatApiSettings>(
    VRCHAT_API_SETTINGS_DEFAULT
  );
  private _status: BehaviorSubject<VRChatServiceStatus> = new BehaviorSubject<VRChatServiceStatus>(
    'PRE_INIT'
  );
  private _user: BehaviorSubject<CurrentUser | null> = new BehaviorSubject<CurrentUser | null>(
    null
  );
  private userAgent!: string;
  private socket?: WebSocket;
  private loginExpired = false;
  private apiCallQueue: TaskQueue = new TaskQueue({
    rateLimiter: {
      totalPerMinute: 15,
      typePerMinute: {
        STATUS_CHANGE: 6,
        DELETE_NOTIFICATION: 3,
        INVITE: 6,
      },
    },
  });
  private eventHandler: VRChatEventHandlerManager;
  private _world: BehaviorSubject<WorldContext> = new BehaviorSubject<WorldContext>({
    playerCount: 1,
  });

  public user: Observable<CurrentUser | null> = this._user.asObservable();
  public status: Observable<VRChatServiceStatus> = this._status.asObservable();
  public world: Observable<WorldContext> = combineLatest([
    this._world,
    this.logService.initialLoadComplete.pipe(filter((complete) => complete)),
  ]).pipe(map(([world]) => world));

  constructor(private modalService: SimpleModalService, private logService: VRChatLogService) {
    this.eventHandler = new VRChatEventHandlerManager(this);
  }

  async init() {
    this.http = await getClient();
    // Load settings from disk
    await this.loadSettings();
    // Construct user agent
    this.userAgent = `Oyasumi/${await getVersion()} (https://github.com/Raphiiko/Oyasumi)`;
    // Setup socket connection management
    await this.manageSocketConnection();
    // Fetch the api config if needed
    if (!this.settings.value.apiKey) await this.fetchApiConfig();
    // If we could not, error out (reinit required)
    if (this._status.value === 'ERROR') return;
    // Load existing session if possible
    await this.loadSession();
    // Depending on if we have a user, set the status
    const newStatus = this._user.value ? 'LOGGED_IN' : 'LOGGED_OUT';
    if (newStatus !== this._status.value) this._status.next(newStatus);
    // Show the login modal if we were just logged out due to token expiry
    if (this.loginExpired) {
      console.log('Logging out because of login expiry.');
      await this.logout();
      this.showLoginModal();
    }
    console.log('USER', this._user.value);
    // Process VRChat log events
    await this.subscribeToLogEvents();
  }

  //
  // PUBLIC API
  //

  public async logout() {
    await this.updateSettings({
      authCookie: undefined,
      authCookieExpiry: undefined,
      twoFactorCookie: undefined,
      twoFactorCookieExpiry: undefined,
    });
    this._status.next('LOGGED_OUT');
  }

  // Will throw in the case of:
  // - 2FA_REQUIRED
  // - INVALID_CREDENTIALS
  // - CHECK_EMAIL
  // - UNEXPECTED_RESPONSE
  public async login(username: string, password: string): Promise<void> {
    if (this._status.value !== 'LOGGED_OUT')
      throw new Error('Tried calling login() while already logged in');
    this._user.next(await this.getCurrentUser({ username, password }));
    // If we got here, we have a user, so we are logged in (and have cookies)
    this._status.next('LOGGED_IN');
  }

  // Will throw in the case of:
  // - INVALID_CODE
  // - UNEXPECTED_RESPONSE
  public async verify2FA(code: string) {
    if (this._status.value !== 'LOGGED_OUT')
      throw new Error('Tried calling verify2FA() while already logged in');
    const { authCookie, authCookieExpiry } = this.settings.value;
    if (!authCookie || (authCookieExpiry && authCookieExpiry < Date.now() / 1000))
      throw new Error('Called verify2FA() before successfully calling login()');
    const headers = this.getDefaultHeaders();
    const response = await this.http.post(
      `${BASE_URL}/auth/twofactorauth/totp/verify`,
      Body.json({ code }),
      {
        headers,
        responseType: ResponseType.JSON,
      }
    );
    // If we received a 401, the code was likely incorrect
    if (response.status === 400) {
      if ((response.data as any)?.verified === false) throw 'INVALID_CODE';
    }
    // If it's not ok, it's unexpected
    if (!response.ok || (response.data as any)?.verified === false) {
      console.error('Received unexpected response from /auth/twofactorauth/totp/verify', response);
      throw 'UNEXPECTED_RESPONSE';
    }
    // Process any auth cookie if we get any
    await this.parseCookies(response);
    // Try getting the current user again
    this._user.next(await this.getCurrentUser());
    // If we got here, we are logged in (and have cookies)
    this._status.next('LOGGED_IN');
  }

  async setStatus(status: UserStatus): Promise<void> {
    // Throw if we don't have a current user
    const userId = this._user.value?.id;
    if (!userId) throw new Error('Tried setting status while not logged in');
    // Don't do anything if the status is not changing
    if (this._user.value?.status === status) return;
    // Send status change request
    const response = await this.apiCallQueue.queueTask<Response<unknown>>(
      {
        typeId: 'STATUS_CHANGE',
        runnable: () =>
          this.http.put(`${BASE_URL}/users/${userId}`, Body.json({ status }), {
            headers: this.getDefaultHeaders(),
          }),
      },
      true
    );
    if (response.result && response.result.ok) this.patchCurrentUser({ status });
  }

  public showLoginModal() {
    this.modalService
      .addModal(
        VRChatLoginModalComponent,
        {},
        {
          closeOnEscape: false,
          closeOnClickOutside: false,
        }
      )
      .subscribe((data) => {});
  }

  public patchCurrentUser(user: Partial<CurrentUser>) {
    const currentUser = cloneDeep(this._user.value);
    if (!currentUser) return;
    Object.assign(currentUser, user);
    this._user.next(currentUser);
  }

  public async handleNotification(notification: Notification) {
    console.log('Received notification', notification);
    switch (notification.type) {
      case NotificationType.RequestInvite:
        await this.handleRequestInviteNotification(notification);
        break;
    }
  }

  public async deleteNotification(notificationId: string) {
    // Throw if we don't have a current user
    const userId = this._user.value?.id;
    if (!userId) throw new Error('Tried deleting a notification while not logged in');
    // Send
    const response = await this.apiCallQueue.queueTask<Response<Notification>>({
      typeId: 'DELETE_NOTIFICATION',
      runnable: () =>
        this.http.put(`${BASE_URL}/auth/user/notifications/${notificationId}/hide`, undefined, {
          headers: this.getDefaultHeaders(),
        }),
    });
    console.log('DELETE NOTIFICATION', response)
  }

  public async inviteUser(inviteeId: string, instanceId?: string) {
    // Throw if we don't have a current user
    const userId = this._user.value?.id;
    if (!userId) throw new Error('Tried accepting an invite request while not logged in');
    // Throw if instance id was not provided and we don't know the current world id.
    if (!instanceId) instanceId = this._world.value?.instanceId;
    if (!instanceId)
      throw new Error('Cannot invite a user when the current world instance is unknown');
    // Send
    const response = await this.apiCallQueue.queueTask<Response<Notification>>({
      typeId: 'INVITE',
      runnable: () =>
        this.http.post(`${BASE_URL}/invite/${inviteeId}`, Body.json({ instanceId }), {
          headers: this.getDefaultHeaders(),
        }),
    });
  }

  //
  // INTERNALS
  //

  private async handleRequestInviteNotification(notification: Notification) {
    // Automatically accept invite requests when on blue, in case the VRChat client does not.
    const user = this._user.value;
    if (!user || user.status !== UserStatus.JoinMe) return;
    await this.deleteNotification(notification.id);
    await this.inviteUser(notification.senderUserId);
  }

  private async subscribeToLogEvents() {
    this.logService.logEvents.subscribe((event) => {
      switch (event.type) {
        case 'OnPlayerJoined':
          this._world.next({
            ...cloneDeep(this._world.value),
            playerCount: this._world.value.playerCount + 1,
          });
          break;
        case 'OnPlayerLeft':
          this._world.next({
            ...cloneDeep(this._world.value),
            playerCount: Math.max(this._world.value.playerCount - 1, 0),
          });
          break;
        case 'OnLocationChange':
          this._world.next({
            ...cloneDeep(this._world.value),
            playerCount: 0,
            instanceId: event.instanceId
          });
          break;
      }
    });
  }

  private async loadSession() {
    // If we already have an auth cookie, get the current user for it
    if (this.settings.value.authCookie) {
      try {
        this._user.next(await this.getCurrentUser());
      } catch (e) {
        switch (e) {
          case 'INVALID_CREDENTIALS':
          case 'CHECK_EMAIL':
          case '2FA_REQUIRED':
            // With these errors, clear the currently known credentials
            await this.updateSettings({
              authCookie: undefined,
              authCookieExpiry: undefined,
              twoFactorCookie: undefined,
              twoFactorCookieExpiry: undefined,
            });
            break;
          default:
            // Ignore other errors (We might just not have a connection)
            break;
        }
      }
    }
  }

  private async manageSocketConnection() {
    const buildSocket = () => {
      if (this.socket) {
        try {
          this.socket.close();
        } catch (e) {
          // Ignore any error, we just want to disconnect
        }
        this.socket = undefined;
      }
      this.socket = new WebSocket(
        'wss://pipeline.vrchat.cloud/?authToken=' + this.settings.value.authCookie
      );
      this.socket.onopen = () => this.onSocketEvent('OPEN');
      this.socket.onerror = () => this.onSocketEvent('ERROR');
      this.socket.onclose = () => this.onSocketEvent('CLOSE');
      this.socket.onmessage = (message) => this.onSocketEvent('MESSAGE', message);
    };
    // Connect and disconnect based on login status
    this._status.pipe(distinctUntilChanged()).subscribe((status) => {
      switch (status) {
        case 'LOGGED_OUT':
          if (this.socket) {
            try {
              this.socket.close();
            } catch (e) {
              // Ignore any error, we just want to disconnect
            }
            this.socket = undefined;
          }
          break;
        case 'LOGGED_IN':
          buildSocket();
          break;
      }
    });
    // Check connection intermittently in case of dropouts
    interval(10000)
      .pipe(filter(() => this._status.value === 'LOGGED_IN'))
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
    if (event !== 'MESSAGE') return;
    const data = JSON.parse(message?.data as string);
    this.eventHandler.handle(data.type, data.content);
  }

  private async getCurrentUser(credentials?: {
    username: string;
    password: string;
  }): Promise<CurrentUser> {
    // Set available headers
    const headers: Record<string, string> = {
      ...this.getDefaultHeaders(!credentials),
    };
    if (credentials) {
      // Set credentials
      headers['Authorization'] = `Basic ${btoa(
        encodeURIComponent(credentials.username) + ':' + encodeURIComponent(credentials.password)
      )}`;
    }
    // Request the current user
    const response = await this.http.get<CurrentUser | { requiresTwoFactorAuth: string[] }>(
      `${BASE_URL}/auth/user`,
      {
        headers,
        responseType: ResponseType.JSON,
      }
    );
    // If we received a 401, there is probably an error included
    if (response.status === 401) {
      // Try parse the error message
      const message: string = (response.data as any)?.error?.message;
      // Check for known errors
      switch (message) {
        case '\\"It looks like you\'re logging in from somewhere new! Check your email for a message from VRChat.\\"':
          throw 'CHECK_EMAIL';
        case '"Invalid Username/Email or Password"':
          throw 'INVALID_CREDENTIALS';
        default:
          console.error('Received unexpected response from /auth/user', response.data);
          throw 'UNEXPECTED_RESPONSE';
      }
    }
    // If it's not ok, it's unexpected
    if (!response.ok) {
      console.error('Received unexpected response from /auth/user', response);
      throw 'UNEXPECTED_RESPONSE';
    }
    // Process any auth cookie if we get any (even if we still need to verify 2FA)
    await this.parseCookies(response);
    // If we got a missing 2FA response, throw
    if (response.data.hasOwnProperty('requiresTwoFactorAuth')) throw '2FA_REQUIRED';
    // Otherwise, return the fetched user
    return response.data as CurrentUser;
  }

  private async fetchApiConfig() {
    const response = await this.http.get<APIConfig>(`${BASE_URL}/config`, {
      responseType: ResponseType.JSON,
      headers: this.getDefaultHeaders(),
    });
    if (response.ok) {
      // Store config if we end up needing it in the future
      await this.parseCookies(response);
    } else {
      this._status.next('ERROR');
    }
  }

  private getDefaultHeaders(allow2FACookie = true): Record<string, string> {
    const settings = this.settings.value;
    const cookies = [];
    if (settings.apiKey) cookies.push(serializeCookie('apiKey', settings.apiKey));
    if (settings.authCookie) cookies.push(serializeCookie('auth', settings.authCookie));
    if (settings.twoFactorCookie && allow2FACookie)
      cookies.push(serializeCookie('twoFactor', settings.twoFactorCookie));
    return { Cookie: cookies.join('; '), 'User-Agent': this.userAgent };
  }

  private async parseCookies(response: Response<any>) {
    if (!response.headers['set-cookie']) return;
    const cookies = parseSetCookieHeader(response.headers['set-cookie']);
    for (let cookie of cookies) {
      const expiry = Math.floor((cookie.expires || new Date()).getTime() / 1000);
      switch (cookie.name) {
        case 'apiKey':
          await this.updateSettings({
            apiKey: cookie.value,
            apiKeyExpiry: Math.floor(Date.now() / 1000) + 3600, // Always shift this one hour into the future
          });
          break;
        case 'auth':
          await this.updateSettings({
            authCookie: cookie.value,
            authCookieExpiry: expiry,
          });
          break;
        case 'twoFactorAuth':
          await this.updateSettings({
            twoFactorCookie: cookie.value,
            twoFactorCookieExpiry: expiry,
          });
          break;
      }
    }
  }

  private async loadSettings() {
    let settings: VRChatApiSettings | null = await this.store.get<VRChatApiSettings>(
      SETTINGS_KEY_VRCHAT_API
    );
    settings = settings ? migrateVRChatApiSettings(settings) : this.settings.value;
    // Handle cookie expiry
    this.loginExpired = false;
    if (settings.apiKeyExpiry && settings.apiKeyExpiry < Date.now() / 1000) {
      console.warn('API key expired, throwing it away.');
      settings.apiKey = undefined;
      settings.apiKeyExpiry = undefined;
    }
    if (settings.authCookieExpiry && settings.authCookieExpiry < Date.now() / 1000) {
      console.warn('Auth cookie expired, throwing it away.');
      settings.authCookie = undefined;
      settings.authCookieExpiry = undefined;
      this.loginExpired = true;
    }
    if (settings.twoFactorCookieExpiry && settings.twoFactorCookieExpiry < Date.now() / 1000) {
      console.warn('Two factor cookie expired, throwing it away.');
      settings.twoFactorCookie = undefined;
      settings.twoFactorCookieExpiry = undefined;
      this.loginExpired = true;
    }
    // Finish loading settings & write changes to disk
    this.settings.next(settings);
    await this.saveSettings();
  }

  private async updateSettings(settings: Partial<VRChatApiSettings>) {
    const newSettings = Object.assign(cloneDeep(this.settings.value), settings);
    this.settings.next(newSettings);
    await this.saveSettings();
  }

  private async saveSettings() {
    await this.store.set(SETTINGS_KEY_VRCHAT_API, this.settings.value);
    await this.store.save();
  }
}
