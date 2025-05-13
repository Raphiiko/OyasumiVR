import { error, info } from '@tauri-apps/plugin-log';
import { VRChatAPI } from './vrchat-api';
import { ModalService } from '../modal.service';
import { VRChatLoginModalComponent } from 'src-ui/app/components/vrchat-login-modal/vrchat-login-modal.component';
import {
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  firstValueFrom,
  interval,
  Observable,
} from 'rxjs';
import { CurrentUser } from 'vrchat';
import { VRChatApiSettings } from 'src-ui/app/models/vrchat-api-settings';
import {
  decryptStorageData,
  deserializeStorageCryptoKey,
  encryptStorageData,
  generateStorageCryptoKey,
  serializeStorageCryptoKey,
} from 'src-ui/app/utils/crypto';

export type VRChatAuthStatus = 'PRE_INIT' | 'LOGGED_OUT' | 'LOGGED_IN';

export class VRChatAuth {
  private _status: BehaviorSubject<VRChatAuthStatus> = new BehaviorSubject<VRChatAuthStatus>(
    'PRE_INIT'
  );
  public status = this._status.asObservable();
  private _user: BehaviorSubject<CurrentUser | null> = new BehaviorSubject<CurrentUser | null>(
    null
  );
  public user = this._user.asObservable();
  private loginExpired = false;
  private _userUpdateEventLastReceived = new BehaviorSubject<number>(0);
  private _userStatusLastUpdated = new BehaviorSubject<number>(0);

  constructor(
    private api: VRChatAPI,
    private modalService: ModalService,
    private updateSettings: (settings: Partial<VRChatApiSettings>) => Promise<void>,
    private settings: Observable<VRChatApiSettings>
  ) {}

  //
  // Initialization
  //

  public async init() {
    // Load existing session if possible
    await this.loadSession();
    // Depending on if we have a user, set the status
    const newStatus = this._user.value ? 'LOGGED_IN' : 'LOGGED_OUT';
    if (newStatus !== this._status.value) this._status.next(newStatus);
    // Show the login modal if we were just logged out due to token expiry
    if (this.loginExpired) {
      info(`[VRChat] Login expired.`);
      this.showLoginModal(true);
    }
    this.pollUserForStatus();
    // Handle login side effects
    this._user
      .pipe(
        distinctUntilChanged(),
        debounceTime(500),
        distinctUntilChanged((prev, curr) => prev?.id !== curr?.id)
      )
      .subscribe((user) => {
        if (user) {
          // List friends on login to make sure they are cached
          this.api.listFriends();
        }
      });
  }

  public handleSettingsLoad(settings: VRChatApiSettings) {
    this.loginExpired = false;
    if (settings.authCookieExpiry && settings.authCookieExpiry < Date.now() / 1000) {
      info('[VRChat] Auth cookie expired, throwing it away.');
      settings.authCookie = null;
      settings.authCookieExpiry = null;
      this.loginExpired = true;
    }
    if (settings.twoFactorCookieExpiry && settings.twoFactorCookieExpiry < Date.now() / 1000) {
      info('[VRChat] Two factor cookie expired, throwing it away.');
      settings.twoFactorCookie = null;
      settings.twoFactorCookieExpiry = null;
      this.loginExpired = true;
    }
  }

  private async loadSession() {
    // If we already have an auth cookie, get the current user for it
    if ((await firstValueFrom(this.settings)).authCookie) {
      try {
        this._user.next(await this.api.getCurrentUser());
        this._userStatusLastUpdated.next(Date.now());
        info(`[VRChat] Restored existing session`);
      } catch (e) {
        switch (e) {
          case 'INVALID_CREDENTIALS':
          case 'MISSING_CREDENTIALS':
          case 'CHECK_EMAIL':
          case '2FA_TOTP_REQUIRED':
          case '2FA_EMAILOTP_REQUIRED':
          case '2FA_OTP_REQUIRED':
            await this.updateSettings({
              authCookie: null,
              authCookieExpiry: null,
              twoFactorCookie: null,
              twoFactorCookieExpiry: null,
            });
            info(`[VRChat] Failed to restore session: ${e}`);
            break;
          default:
            error(`[VRChat] Error trying to restore session: ${e}`);
            break;
        }
      }
    }
  }

  //
  // Authentication methods
  //

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

  /**
   * Attempts to log in to VRChat using the provided credentials
   *
   * @param {string} username - VRChat username or email
   * @param {string} password - VRChat password
   * @returns {Promise<void>} - Resolves when login is successful
   * @throws {'2FA_TOTP_REQUIRED'} - When time-based OTP verification is needed
   * @throws {'2FA_EMAILOTP_REQUIRED'} - When email-based OTP verification is needed
   * @throws {'2FA_OTP_REQUIRED'} - When another form of OTP verification is needed
   * @throws {'INVALID_CREDENTIALS'} - When provided credentials are incorrect
   * @throws {'CHECK_EMAIL'} - When login attempt triggered VRChat to send verification email
   * @throws {'UNEXPECTED_RESPONSE'} - When API returns an unexpected error
   */
  public async login(username: string, password: string): Promise<void> {
    if (this._status.value !== 'LOGGED_OUT')
      throw new Error('Tried calling login() while already logged in');
    this._user.next(await this.api.getCurrentUser({ username, password }, true));
    this._userStatusLastUpdated.next(Date.now());
    // If we got here, we have a user, so we are logged in (and have cookies)
    this._status.next('LOGGED_IN');
    info(`[VRChat] Logged in: ${this._user.value?.displayName}`);
  }

  /**
   * Verifies a two-factor authentication code after a successful initial login
   *
   * @param {string} code - The verification code provided by the user
   * @param {'totp'|'otp'|'emailotp'} method - The 2FA method to use for verification
   * @returns {Promise<void>} - Resolves when 2FA verification is successful
   * @throws {'INVALID_CODE'} - When the provided verification code is incorrect
   * @throws {'UNEXPECTED_RESPONSE'} - When API returns an unexpected error
   * @throws {Error} - When called while already logged in or without auth cookie
   */
  public async verify2FA(code: string, method: 'totp' | 'otp' | 'emailotp') {
    if (this._status.value !== 'LOGGED_OUT') {
      error(`[VRChat] Tried calling verify2FA() while already logged in`);
      throw new Error('Tried calling verify2FA() while already logged in');
    }
    const { authCookie, authCookieExpiry } = await firstValueFrom(this.settings);
    if (!authCookie || (authCookieExpiry && authCookieExpiry < Date.now() / 1000))
      throw new Error('Called verify2FA() before successfully calling login()');
    this.api.verify2FA(code, method);
    // Try getting the current user again
    this._user.next(await this.api.getCurrentUser(undefined, true));
    this._userStatusLastUpdated.next(Date.now());
    // If we got here, we are logged in (and have cookies)
    this._status.next('LOGGED_IN');
    info(`[VRChat] Logged in: ${this._user.value?.displayName}`);
  }

  public async logout() {
    this.api.clearCaches();
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

  //
  // User state management
  //

  public patchCurrentUser(user: Partial<CurrentUser>) {
    const currentUser = structuredClone(this._user.value);
    if (!currentUser) return;
    Object.assign(currentUser, user);
    this._user.next(currentUser);
    if (user.status) this._userStatusLastUpdated.next(Date.now());
  }

  public receivedUserUpdate(user: Partial<CurrentUser>) {
    this.patchCurrentUser(user);
    // We keep track of when the last `user-update` socket event was received
    // because if we received these, we know we don't have to poll.
    // There are some cases where users don't receive these events, in which case we need to poll.
    // If we receive at least one, we know these events are working and we can disable polling.
    this._userUpdateEventLastReceived.next(Date.now());
  }

  private pollUserForStatus() {
    interval(60000).subscribe(async () => {
      if (this._status.value !== 'LOGGED_IN') return;
      // Poll for user updates if we don't receive any from socket
      const needsPolling =
        Date.now() - this._userUpdateEventLastReceived.value > 60 * 60 * 1000 && // 1 hour
        Date.now() - this._userStatusLastUpdated.value > 10 * 60 * 1000; // 10 minutes
      if (!needsPolling) return;
      try {
        // Try poll user
        const result = await this.api.pollCurrentUser();
        if (result.error === null && result.result) {
          this.patchCurrentUser(result.result);
        }
      } catch (e) {
        error(`[VRChat] Error polling user: ${JSON.stringify(e)}`);
      }
    });
  }

  //
  // Credential management
  //

  public async rememberCredentials(username: string, password: string) {
    const credentialCryptoKey = (await firstValueFrom(this.settings)).credentialCryptoKey;
    if (!credentialCryptoKey) return;
    // Obtain the storage crypto key
    let key: CryptoKey;
    try {
      key = await deserializeStorageCryptoKey(credentialCryptoKey);
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
    const { credentialCryptoKey, rememberedCredentials } = await firstValueFrom(this.settings);
    if (!credentialCryptoKey || !rememberedCredentials) return null;
    // Obtain the storage crypto key
    let key: CryptoKey;
    try {
      key = await deserializeStorageCryptoKey(credentialCryptoKey);
    } catch (e) {
      error('[VRChat] Failed to deserialize storage crypto key: ' + JSON.stringify(e));
      this.cycleCredentialCryptoKey();
      return null;
    }
    // Decrypt credentials
    let credentials: string;
    try {
      credentials = await decryptStorageData(rememberedCredentials, key);
      const [username, password] = credentials.split(':').map((c) => atob(c));
      return { username, password };
    } catch (e) {
      error('[VRChat] Failed to decrypt remembered credentials: ' + JSON.stringify(e));
      this.cycleCredentialCryptoKey();
      return null;
    }
  }

  private async cycleCredentialCryptoKey() {
    info('[VRChat] Cycling the storage crypto key');
    await this.updateSettings({
      rememberedCredentials: null,
      rememberCredentials: false,
      credentialCryptoKey: await serializeStorageCryptoKey(await generateStorageCryptoKey()),
    });
  }
}
