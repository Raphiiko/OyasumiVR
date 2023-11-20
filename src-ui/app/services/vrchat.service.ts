import { Injectable } from '@angular/core';
import { Body, Client, getClient, HttpOptions, Response, ResponseType } from '@tauri-apps/api/http';
import { CurrentUser, LimitedUser, Notification, UserStatus } from 'vrchat/dist';
import { parse as parseSetCookieHeader } from 'set-cookie-parser';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE, SETTINGS_KEY_VRCHAT_API } from '../globals';
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
  Subject,
} from 'rxjs';
import { cloneDeep } from 'lodash';
import { serialize as serializeCookie } from 'cookie';
import { getVersion } from '../utils/app-utils';
import { VRChatEventHandlerManager } from './vrchat-events/vrchat-event-handler';
import { VRChatLoginModalComponent } from '../components/vrchat-login-modal/vrchat-login-modal.component';
import { ModalService } from 'src-ui/app/services/modal.service';
import { TaskQueue } from '../utils/task-queue';
import { WorldContext } from '../models/vrchat';
import { VRChatLogService } from './vrchat-log.service';
import { CachedValue } from '../utils/cached-value';
import { error, info, warn } from 'tauri-plugin-log-api';
import {
  decryptStorageData,
  deserializeStorageCryptoKey,
  encryptStorageData,
  generateStorageCryptoKey,
  serializeStorageCryptoKey,
} from '../utils/crypto';
import { invoke } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';

const BASE_URL = 'https://api.vrchat.cloud/api/1';
const MAX_VRCHAT_FRIENDS = 65536;
export type VRChatServiceStatus = 'PRE_INIT' | 'LOGGED_OUT' | 'LOGGED_IN';

@Injectable({
  providedIn: 'root',
})
export class VRChatService {
  private http!: Client;
  private store = new Store(SETTINGS_FILE);
  private _settings = new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT);
  public settings = this._settings.asObservable();
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
        LIST_FRIENDS: 15,
        POLL_USER: 1,
      },
    },
  });
  private eventHandler: VRChatEventHandlerManager;
  private _currentUserCache: CachedValue<CurrentUser> = new CachedValue<CurrentUser>(
    undefined,
    5 * 60 * 1000, // Cache for 5 minutes
    'VRCHAT_CURRENT_USER'
  );
  private _world: BehaviorSubject<WorldContext> = new BehaviorSubject<WorldContext>({
    playerCount: 1,
  });
  private _friendsCache: CachedValue<LimitedUser[]> = new CachedValue<LimitedUser[]>(
    undefined,
    60 * 60 * 1000, // Cache for 1 hour
    'VRCHAT_FRIENDS'
  );
  private _notifications: Subject<Notification> = new Subject<Notification>();
  private _userStatusLastUpdated = new BehaviorSubject<number>(0);
  private _userUpdateEventLastReceived = new BehaviorSubject<number>(0);
  private _vrchatProcessActive = new BehaviorSubject(false);

  public user: Observable<CurrentUser | null> = this._user.asObservable();
  public status: Observable<VRChatServiceStatus> = this._status.asObservable();
  public world: Observable<WorldContext> = combineLatest([
    this._world,
    this.logService.initialLoadComplete.pipe(filter((complete) => complete)),
  ]).pipe(map(([world]) => world));
  public notifications = this._notifications.asObservable();
  public vrchatProcessActive = this._vrchatProcessActive.asObservable();

  constructor(private modalService: ModalService, private logService: VRChatLogService) {
    this.eventHandler = new VRChatEventHandlerManager(this);
  }

  async init() {
    this.http = await this.patchHttpClient(await getClient());
    // Load settings from disk
    await this.loadSettings();
    // Construct user agent
    this.userAgent = `OyasumiVR/${await getVersion()} (https://github.com/Raphiiko/OyasumiVR)`;
    // Setup socket connection management
    await this.manageSocketConnection();
    // Load existing session if possible
    await this.loadSession();
    // Depending on if we have a user, set the status
    const newStatus = this._user.value ? 'LOGGED_IN' : 'LOGGED_OUT';
    if (newStatus !== this._status.value) this._status.next(newStatus);
    // Show the login modal if we were just logged out due to token expiry
    if (this.loginExpired) {
      info(`[VRChat] Login expired. Logging out.`);
      await this.logout();
      this.showLoginModal(true);
    }
    // Process VRChat log events
    await this.subscribeToLogEvents();
    // Poll user for updating status
    await this.pollUserForStatus();
    // Set the VRChat process active state
    await listen<boolean>('VRCHAT_PROCESS_ACTIVE', (event) =>
      this._vrchatProcessActive.next(event.payload)
    );
    this._vrchatProcessActive.next(await invoke<boolean>('is_vrchat_active'));
  }

  //
  // PUBLIC UTILITIES
  //

  public imageUrlForPlayer(player: LimitedUser) {
    return player.userIcon || player.profilePicOverride || player.currentAvatarThumbnailImageUrl;
  }

  //
  // PUBLIC API
  //

  public async logout() {
    this._currentUserCache.clear();
    this._friendsCache.clear();
    await this.updateSettings({
      authCookie: undefined,
      authCookieExpiry: undefined,
      twoFactorCookie: undefined,
      twoFactorCookieExpiry: undefined,
    });
    this._user.next(null);
    this._status.next('LOGGED_OUT');
    info(`[VRChat] Logged out`);
  }

  // Will throw in the case of:
  // - 2FA_TOTP_REQUIRED
  // - 2FA_EMAILOTP_REQUIRED
  // - 2FA_OTP_REQUIRED
  // - INVALID_CREDENTIALS
  // - CHECK_EMAIL
  // - UNEXPECTED_RESPONSE
  public async login(username: string, password: string): Promise<void> {
    if (this._status.value !== 'LOGGED_OUT')
      throw new Error('Tried calling login() while already logged in');
    this._user.next(await this.getCurrentUser({ username, password }, true));
    // If we got here, we have a user, so we are logged in (and have cookies)
    this._status.next('LOGGED_IN');
    info(`[VRChat] Logged in: ${this._user.value?.displayName}`);
  }

  // Will throw in the case of:
  // - INVALID_CODE
  // - UNEXPECTED_RESPONSE
  public async verify2FA(code: string, method: 'totp' | 'otp' | 'emailotp') {
    if (this._status.value !== 'LOGGED_OUT') {
      error(`[VRChat] Tried calling verify2FA() while already logged in`);
      throw new Error('Tried calling verify2FA() while already logged in');
    }
    const { authCookie, authCookieExpiry } = this._settings.value;
    if (!authCookie || (authCookieExpiry && authCookieExpiry < Date.now() / 1000))
      throw new Error('Called verify2FA() before successfully calling login()');
    const headers = this.getDefaultHeaders();
    const response = await this.http.post(
      `${BASE_URL}/auth/twofactorauth/${method}/verify`,
      Body.json({ code }),
      {
        headers,
        responseType: ResponseType.JSON,
      }
    );
    // If we received a 401, the code was likely incorrect
    if (response.status === 400) {
      if ((response.data as any)?.verified === false) {
        warn(`[VRChat] 2FA Verification failed: Invalid code`);
        throw 'INVALID_CODE';
      }
    }
    // If it's not ok, it's unexpected
    if (!response.ok || (response.data as any)?.verified === false) {
      error(
        `[VRChat] Received unexpected response from /auth/twofactorauth/${method}/verify: ${JSON.stringify(
          response
        )}`
      );
      throw 'UNEXPECTED_RESPONSE';
    }
    // Process any auth cookie if we get any
    await this.parseResponseCookies(response);
    // Try getting the current user again
    this._user.next(await this.getCurrentUser(undefined, true));
    // If we got here, we are logged in (and have cookies)
    this._status.next('LOGGED_IN');
    info(`[VRChat] Logged in: ${this._user.value?.displayName}`);
  }

  async setStatus(status: UserStatus): Promise<void> {
    // Throw if we don't have a current user
    const userId = this._user.value?.id;
    if (!userId) {
      error(`[VRChat] Tried setting status while not logged in`);
      throw new Error('Tried setting status while not logged in');
    }
    // Don't do anything if the status is not changing
    if (this._user.value?.status === status) return;
    // Send status change request
    info(`[VRChat] Setting status to '${status}'`);
    try {
      const result = await this.apiCallQueue.queueTask<Response<unknown>>(
        {
          typeId: 'STATUS_CHANGE',
          runnable: () => {
            return this.http.put(`${BASE_URL}/users/${userId}`, Body.json({ status }), {
              headers: this.getDefaultHeaders(),
            });
          },
        },
        true
      );
      if (result.result && result.result.ok) this.patchCurrentUser({ status });
      if (result.error) throw result.error;
      if (!result.result?.ok) throw result.result;
    } catch (e) {
      error(`[VRChat] Failed to delete notification: ${JSON.stringify(e)}`);
    }
  }

  public showLoginModal(autoLogin = false) {
    this.modalService
      .addModal(
        VRChatLoginModalComponent,
        { autoLogin },
        {
          closeOnEscape: false,
        }
      )
      .subscribe(() => {});
  }

  public patchCurrentUser(user: Partial<CurrentUser>) {
    const currentUser = cloneDeep(this._user.value);
    if (!currentUser) return;
    Object.assign(currentUser, user);
    this._user.next(currentUser);
    if (user.status) this._userStatusLastUpdated.next(Date.now());
  }

  public async handleNotification(notification: Notification) {
    info(`[VRChat] Received notification: ${JSON.stringify(notification)}`);
    this._notifications.next(notification);
  }

  public async deleteNotification(notificationId: string) {
    // Throw if we don't have a current user
    const userId = this._user.value?.id;
    if (!userId) {
      error('[VRChat] Tried deleting a notification while not logged in');
      throw new Error('Tried deleting a notification while not logged in');
    }
    // Send
    info(`[VRChat] Deleting notification 'notificationId'`);
    try {
      const result = await this.apiCallQueue.queueTask<Response<Notification>>({
        typeId: 'DELETE_NOTIFICATION',
        runnable: () => {
          return this.http.put(
            `${BASE_URL}/auth/user/notifications/${notificationId}/hide`,
            undefined,
            {
              headers: this.getDefaultHeaders(),
            }
          );
        },
      });
      if (result.error) throw result.error;
      if (!result.result?.ok) throw result.result;
    } catch (e) {
      error(`[VRChat] Failed to delete notification: ${JSON.stringify(e)}`);
    }
  }

  public async inviteUser(inviteeId: string, instanceId?: string) {
    // Throw if we don't have a current user
    const userId = this._user.value?.id;
    if (!userId) {
      error('[VRChat] Tried inviting a user while not logged in');
      throw new Error('Tried inviting a user while not logged in');
    }
    // Throw if instance id was not provided and we don't know the current world id.
    if (!instanceId) instanceId = this._world.value?.instanceId;
    if (!instanceId) {
      error('[VRChat] Tried inviting a user when the current world instance is unknown');
      throw new Error('Cannot invite a user when the current world instance is unknown');
    }
    // Send
    await this.apiCallQueue.queueTask<Response<Notification>>({
      typeId: 'INVITE',
      runnable: () => {
        return this.http.post(`${BASE_URL}/invite/${inviteeId}`, Body.json({ instanceId }), {
          headers: this.getDefaultHeaders(),
        });
      },
    });
  }

  public async listFriends(force = false): Promise<LimitedUser[]> {
    // If we have a valid cache and aren't forcing the fetch, return the cached value
    if (!force) {
      const cachedFriends = this._friendsCache.get();
      if (cachedFriends) {
        return cachedFriends;
      }
    }
    // Throw if we don't have a current user
    const userId = this._user.value?.id;
    if (!userId) {
      error('[VRChat] Tried listing friends while not logged in');
      throw new Error('Tried listing friends while not logged in');
    }
    // Fetch friends
    const friends: LimitedUser[] = [];
    // Fetch online and active friends
    for (const offline of ['false', 'true']) {
      try {
        for (let offset = 0; offset < MAX_VRCHAT_FRIENDS; offset += 100) {
          // Send request
          const response = await this.apiCallQueue.queueTask<Response<LimitedUser[]>>({
            typeId: 'LIST_FRIENDS',
            runnable: () => {
              return this.http.get(`${BASE_URL}/auth/user/friends`, {
                headers: this.getDefaultHeaders(),
                query: {
                  offset: offset.toString(),
                  n: '100',
                  offline,
                },
              });
            },
          });
          if (response.result && response.result.ok) {
            // Add friends to list
            friends.push(...response.result.data);
            // If we got some friends, continue fetching
            if (response.result.data.length > 0) continue;
          }
          break;
        }
      } catch (e) {
        error('[VRChat] Failed to list friends: ' + JSON.stringify(e));
        break;
      }
    }
    this._friendsCache.set(friends);
    return friends;
  }

  public async rememberCredentials(username: string, password: string) {
    if (!this._settings.value.credentialCryptoKey) return;
    // Obtain the storage crypto key
    let key: CryptoKey;
    try {
      key = await deserializeStorageCryptoKey(this._settings.value.credentialCryptoKey);
    } catch (e) {
      error('[VRChat] Failed to deserialize storage crypto key: ' + JSON.stringify(e));
      this.cycleCredentialCryptoKey();
      return;
    }
    // Store credentials
    const credentials = btoa(username) + ':' + btoa(password);
    const encryptedCredentials = await encryptStorageData(credentials, key);
    await this.updateSettings({
      rememberedCredentials: encryptedCredentials,
      rememberCredentials: true,
    });
  }

  public async forgetCredentials() {
    await this.updateSettings({
      rememberedCredentials: null,
      rememberCredentials: false,
    });
  }

  public async loadCredentials(): Promise<{ username: string; password: string } | null> {
    if (!this._settings.value.credentialCryptoKey || !this._settings.value.rememberedCredentials)
      return null;
    // Obtain the storage crypto key
    let key: CryptoKey;
    try {
      key = await deserializeStorageCryptoKey(this._settings.value.credentialCryptoKey);
    } catch (e) {
      error('[VRChat] Failed to deserialize storage crypto key: ' + JSON.stringify(e));
      this.cycleCredentialCryptoKey();
      return null;
    }
    // Decrypt credentials
    let credentials: string;
    try {
      credentials = await decryptStorageData(this._settings.value.rememberedCredentials, key);
      const [username, password] = credentials.split(':').map((c) => atob(c));
      return { username, password };
    } catch (e) {
      error('[VRChat] Failed to decrypt remembered credentials: ' + JSON.stringify(e));
      this.cycleCredentialCryptoKey();
      return null;
    }
  }

  public async cycleCredentialCryptoKey() {
    info('[VRChat] Cycling the storage crypto key');
    await this.updateSettings({
      rememberedCredentials: null,
      rememberCredentials: false,
      credentialCryptoKey: await serializeStorageCryptoKey(await generateStorageCryptoKey()),
    });
  }

  //
  // INTERNALS
  //

  private async pollUserForStatus() {
    interval(5000).subscribe(async () => {
      if (this._status.value !== 'LOGGED_IN' || !this._user.value) return;
      // If we have received a user update event in the past half hour or so,
      // we can assume the update events are working, so we don't need to poll.
      // We'll only poll if we haven't received an update in the past half hour.
      if (Date.now() - this._userStatusLastUpdated.value < 60000 * 30) return;
      // Only refetch every two minutes, if needed
      const lastStatusUpdate = this._userStatusLastUpdated.value;
      if (lastStatusUpdate === 0 && Date.now() - lastStatusUpdate < 60000 * 1) return;
      // Refetch the user
      const result = await this.apiCallQueue.queueTask<CurrentUser>({
        typeId: 'POLL_USER',
        runnable: () => this.getCurrentUser(undefined, true),
      });
      if (!result.error && result.result) this.patchCurrentUser(result.result);
    });
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
            instanceId: event.instanceId,
          });
          break;
      }
    });
  }

  private async loadSession() {
    // If we already have an auth cookie, get the current user for it
    if (this._settings.value.authCookie) {
      try {
        this._user.next(await this.getCurrentUser());
        info(`[VRChat] Restored existing session`);
      } catch (e) {
        switch (e) {
          case 'INVALID_CREDENTIALS':
          case 'MISSING_CREDENTIALS':
          case 'CHECK_EMAIL':
          case '2FA_TOTP_REQUIRED':
          case '2FA_EMAILOTP_REQUIRED':
          case '2FA_OTP_REQUIRED':
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
        'wss://pipeline.vrchat.cloud/?authToken=' + this._settings.value.authCookie
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
    switch (event) {
      case 'OPEN':
        info(`[VRChat] Websocket connection opened`);
        return;
      case 'CLOSE':
        info(`[VRChat] Websocket connection closed`);
        return;
      case 'ERROR':
        error(`[VRChat] Websocket connection error: ${JSON.stringify(message)}`);
        return;
      case 'MESSAGE':
        break;
    }
    if (event !== 'MESSAGE') return;
    const data = JSON.parse(message?.data as string);
    this.eventHandler.handle(data.type, data.content);
  }

  private async getCurrentUser(
    credentials?: {
      username: string;
      password: string;
    },
    force = false
  ): Promise<CurrentUser> {
    // Set available headers
    const headers: Record<string, string> = {
      ...this.getDefaultHeaders(!credentials),
    };
    if (credentials) {
      force = true;
      // Set credentials
      headers['Authorization'] = `Basic ${btoa(
        encodeURIComponent(credentials.username) + ':' + encodeURIComponent(credentials.password)
      )}`;
    }
    // If we have the user cached, return that.
    if (!force) {
      const user = this._currentUserCache.get();
      if (user) {
        info(`[VRChat] Loaded user from cache`);
        return user;
      }
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
        case '"It looks like you\'re logging in from somewhere new! Check your email for a message from VRChat."':
          error(`[VRChat] Login failed: Check email`);
          throw 'CHECK_EMAIL';
        case '"Invalid Username/Email or Password"':
          error(`[VRChat] Login failed: Invalid credentials`);
          throw 'INVALID_CREDENTIALS';
        case '"Missing Credentials"':
          throw 'MISSING_CREDENTIALS';
        default:
          error(
            `[VRChat] Received unexpected response from /auth/user: ${JSON.stringify(response)}`
          );
          throw 'UNEXPECTED_RESPONSE';
      }
    }
    // If it's not ok, it's unexpected
    if (!response.ok) {
      error(`[VRChat] Received unexpected response from /auth/user: ${JSON.stringify(response)}`);
      throw 'UNEXPECTED_RESPONSE';
    }
    // Process any auth cookie if we get any (even if we still need to verify 2FA)
    await this.parseResponseCookies(response);
    // If we got a missing 2FA response, throw
    if (response.data.hasOwnProperty('requiresTwoFactorAuth')) {
      const data = response.data as { requiresTwoFactorAuth: string[] };
      const methods = data.requiresTwoFactorAuth.map((method) => method.toLowerCase());
      info(
        `[VRChat] 2FA Required for login. (methods=${JSON.stringify(data.requiresTwoFactorAuth)})`
      );
      if (methods.includes('totp')) throw '2FA_TOTP_REQUIRED';
      if (methods.includes('emailotp')) throw '2FA_EMAILOTP_REQUIRED';
      if (methods.includes('otp')) throw '2FA_OTP_REQUIRED';
      error(
        '[VRChat] 2FA Required for login, but no supported method found. Available methods: ' +
          JSON.stringify(data.requiresTwoFactorAuth)
      );
      throw '2FA_TOTP_REQUIRED'; // Should never happen but let's use it as a fallback.
    }
    // Cache the user
    const user = response.data as CurrentUser;
    this._currentUserCache.set(user);
    this._userStatusLastUpdated.next(Date.now());
    // Otherwise, return the fetched user
    return user;
  }

  private getDefaultHeaders(allow2FACookie = true): Record<string, string> {
    const settings = this._settings.value;
    const cookies = [];
    if (settings.authCookie) cookies.push(serializeCookie('auth', settings.authCookie));
    if (settings.twoFactorCookie && allow2FACookie)
      cookies.push(serializeCookie('twoFactor', settings.twoFactorCookie));
    return { Cookie: cookies.join('; '), 'User-Agent': this.userAgent };
  }

  private async parseResponseCookies(response: Response<any>) {
    if (!response.rawHeaders['set-cookie']) return;
    const cookieHeaders = response.rawHeaders['set-cookie'];
    for (const cookieHeader of cookieHeaders) {
      const cookies = parseSetCookieHeader(cookieHeader);
      for (const cookie of cookies) {
        const expiry = Math.floor((cookie.expires || new Date()).getTime() / 1000);
        switch (cookie.name) {
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
  }

  private async loadSettings() {
    let settings: VRChatApiSettings | null = await this.store.get<VRChatApiSettings>(
      SETTINGS_KEY_VRCHAT_API
    );
    settings = settings ? migrateVRChatApiSettings(settings) : this._settings.value;
    // Handle cookie expiry
    this.loginExpired = false;
    if (settings.authCookieExpiry && settings.authCookieExpiry < Date.now() / 1000) {
      info('[VRChat] Auth cookie expired, throwing it away.');
      settings.authCookie = undefined;
      settings.authCookieExpiry = undefined;
      this.loginExpired = true;
    }
    if (settings.twoFactorCookieExpiry && settings.twoFactorCookieExpiry < Date.now() / 1000) {
      info('[VRChat] Two factor cookie expired, throwing it away.');
      settings.twoFactorCookie = undefined;
      settings.twoFactorCookieExpiry = undefined;
      this.loginExpired = true;
    }
    // Generate storage crypto key if needed
    if (!settings.credentialCryptoKey) {
      const key = await generateStorageCryptoKey();
      settings.credentialCryptoKey = await serializeStorageCryptoKey(key);
    }
    // Finish loading settings & write changes to disk
    this._settings.next(settings);
    await this.saveSettings();
  }

  private async updateSettings(settings: Partial<VRChatApiSettings>) {
    const newSettings = Object.assign(cloneDeep(this._settings.value), settings);
    this._settings.next(newSettings);
    await this.saveSettings();
  }

  private async saveSettings() {
    await this.store.set(SETTINGS_KEY_VRCHAT_API, this._settings.value);
    await this.store.save();
  }

  private async patchHttpClient(client: Client): Promise<Client> {
    const isDev = (await getVersion()) === '0.0.0';
    const next = client.request.bind(client);

    async function requestWrapper<T>(options: HttpOptions): Promise<Response<T>> {
      info(`[VRChat] API Request: ${options.url}`);
      if (isDev) console.log(`[DEBUG] [VRChat] API Request: ${options.method} ${options.url}`);
      try {
        const response = await next<T>(options);
        if (isDev)
          console.log(
            `[DEBUG] [VRChat] API Response (${response.status}): ${options.method} ${options.url} ` +
              response
          );
        return response;
      } catch (e) {
        error(`[VRChat] HTTP Request Error: ${e}`);
        throw e;
      }
    }

    client.request = requestWrapper.bind(client);
    return client;
  }

  receivedUserUpdate() {
    // We keep track of when the last `user-update` socket event was received
    // because if we received these, we know we don't have to poll.
    // There are some cases where users don't receive these events, in which case we need to poll.
    // If we receive at least one, we know these events are working and we can disable polling.
    this._userUpdateEventLastReceived.next(Date.now());
  }
}
