import { error, info } from '@tauri-apps/plugin-log';
import { twoFactorMethodFromError, VRChatAPI, VRChatTwoFactorMethod } from './vrchat-api';
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
import type { CurrentUser } from 'vrchat';
import { VRChatApiSettings } from 'src-ui/app/models/vrchat-api-settings';
import {
  decryptStorageData,
  deserializeStorageCryptoKey,
  encryptStorageData,
  generateStorageCryptoKey,
  serializeStorageCryptoKey,
} from 'src-ui/app/utils/crypto';

export type VRChatAuthStatus = 'PRE_INIT' | 'LOGGED_OUT' | 'LOGGED_IN';

type SessionRestoreResult =
  | { status: 'NONE' | 'RETRY' }
  | { status: 'RESTORED'; user: CurrentUser }
  | { status: 'LOGIN_REQUIRED'; error?: string }
  | { status: 'TWO_FACTOR_REQUIRED'; method: VRChatTwoFactorMethod };

const LOGIN_MODAL_ID = 'VRCHAT_LOGIN';
const SESSION_RESTORE_RETRY_DELAY = 60_000;
const CURRENT_USER_RETRY_DELAY = 1_000;

export class VRChatAuth {
  private _status: BehaviorSubject<VRChatAuthStatus> = new BehaviorSubject<VRChatAuthStatus>(
    'PRE_INIT'
  );
  public status = this._status.asObservable();
  private _user: BehaviorSubject<CurrentUser | null> = new BehaviorSubject<CurrentUser | null>(
    null
  );
  public user = this._user.asObservable();
  private sessionRestoreRetry?: ReturnType<typeof setTimeout>;
  private sessionRestoreInFlight?: Promise<SessionRestoreResult>;
  private sessionRestoreAbortController?: AbortController;
  private sessionRestoreGeneration = 0;
  private _userUpdateEventLastReceived = new BehaviorSubject<number>(0);
  private _userStatusLastUpdated = new BehaviorSubject<number>(0);

  constructor(
    private api: VRChatAPI,
    private modalService: ModalService,
    private updateSettings: (settings: Partial<VRChatApiSettings>) => Promise<void>,
    private settings: Observable<VRChatApiSettings>
  ) {}

  // initialization

  public async init() {
    const restoreResult = await this.loadSession();
    if (restoreResult.status === 'RESTORED') this.restoreUser(restoreResult.user);
    const newStatus = this._user.value ? 'LOGGED_IN' : 'LOGGED_OUT';
    if (newStatus !== this._status.value) this._status.next(newStatus);
    this.handleSessionRestoreResult(restoreResult);
    this.pollUserForStatus();
    this._user
      .pipe(
        distinctUntilChanged(),
        debounceTime(500),
        distinctUntilChanged((prev, curr) => prev?.id !== curr?.id)
      )
      .subscribe((user) => {
        if (user) {
          this.api.listFriends();
        }
      });
  }

  private async loadSession(signal?: AbortSignal): Promise<SessionRestoreResult> {
    if (!(await firstValueFrom(this.settings)).authCookie) return { status: 'NONE' };
    try {
      const user = await this.api.getCurrentUser(undefined, true, signal);
      info(`[VRChat] Restored existing session`);
      return { status: 'RESTORED', user };
    } catch (e) {
      if (signal?.aborted) return { status: 'RETRY' };
      const method = twoFactorMethodFromError(e);
      if (method) return { status: 'TWO_FACTOR_REQUIRED', method };
      switch (e) {
        case 'INVALID_CREDENTIALS':
        case 'MISSING_CREDENTIALS':
          await this.api.clearCaches();
          await this.updateSettings({
            authCookie: null,
            authCookieExpiry: null,
          });
          info(`[VRChat] Failed to restore session: ${e}`);
          return { status: 'LOGIN_REQUIRED' };
        case 'CHECK_EMAIL':
        case 'UNSUPPORTED_2FA_METHOD':
          info(`[VRChat] Failed to restore session: ${e}`);
          return { status: 'LOGIN_REQUIRED', error: String(e) };
        default:
          error(`[VRChat] Error trying to restore session: ${e}`);
          return { status: 'RETRY' };
      }
    }
  }

  private handleSessionRestoreResult(result: SessionRestoreResult) {
    switch (result.status) {
      case 'TWO_FACTOR_REQUIRED':
        this.showLoginModal(false, result.method);
        break;
      case 'LOGIN_REQUIRED':
        info(`[VRChat] Login expired.`);
        this.showLoginModal(true, undefined, result.error);
        break;
      case 'RETRY':
        this.scheduleSessionRestore();
        break;
    }
  }

  private scheduleSessionRestore() {
    if (this.sessionRestoreRetry || this.sessionRestoreInFlight) return;
    const generation = this.sessionRestoreGeneration;
    this.sessionRestoreRetry = setTimeout(async () => {
      this.sessionRestoreRetry = undefined;
      if (this._status.value !== 'LOGGED_OUT') return;
      const abortController = new AbortController();
      this.sessionRestoreAbortController = abortController;
      const restore = this.loadSession(abortController.signal);
      this.sessionRestoreInFlight = restore;
      const result = await restore.catch((e) => {
        error(`[VRChat] Error trying to restore session: ${e}`);
        return { status: 'RETRY' } as SessionRestoreResult;
      });
      if (this.sessionRestoreInFlight === restore) this.sessionRestoreInFlight = undefined;
      if (this.sessionRestoreAbortController === abortController) {
        this.sessionRestoreAbortController = undefined;
      }
      if (generation !== this.sessionRestoreGeneration) return;
      if (result.status === 'RESTORED') {
        this.restoreUser(result.user);
        this._status.next('LOGGED_IN');
        this.modalService.closeModal(LOGIN_MODAL_ID);
      }
      this.handleSessionRestoreResult(result);
    }, SESSION_RESTORE_RETRY_DELAY);
  }

  private cancelSessionRestore() {
    this.sessionRestoreGeneration++;
    clearTimeout(this.sessionRestoreRetry);
    this.sessionRestoreRetry = undefined;
    this.sessionRestoreAbortController?.abort();
    this.sessionRestoreAbortController = undefined;
  }

  private restoreUser(user: CurrentUser) {
    this._user.next(user);
    this._userStatusLastUpdated.next(Date.now());
  }

  // authentication

  public showLoginModal(
    autoLogin = false,
    twoFactorMethod?: VRChatTwoFactorMethod,
    initialError?: string
  ) {
    if (this.modalService.isModalOpen(LOGIN_MODAL_ID)) return;
    this.modalService
      .addModal(
        VRChatLoginModalComponent,
        { autoLogin, twoFactorMethod, initialError },
        {
          closeOnEscape: false,
          id: LOGIN_MODAL_ID,
        }
      )
      .subscribe(() => {});
  }

  public async login(username: string, password: string): Promise<void> {
    if (this._status.value !== 'LOGGED_OUT')
      throw new Error('Tried calling login() while already logged in');
    this.cancelSessionRestore();
    await this.api.clearCaches();
    this._user.next(await this.api.getCurrentUser({ username, password }, true));
    this._userStatusLastUpdated.next(Date.now());
    this._status.next('LOGGED_IN');
    info(`[VRChat] Logged in: ${this._user.value?.displayName}`);
  }

  public async verify2FA(code: string, method: VRChatTwoFactorMethod) {
    if (this._status.value !== 'LOGGED_OUT') {
      error(`[VRChat] Tried calling verify2FA() while already logged in`);
      throw new Error('Tried calling verify2FA() while already logged in');
    }
    this.cancelSessionRestore();
    await this.api.clearCaches();
    const { authCookie } = await firstValueFrom(this.settings);
    if (!authCookie) throw new Error('Called verify2FA() before successfully calling login()');
    await this.api.verify2FA(code, method);
    this._user.next(await this.getCurrentUserAfter2FA());
    this._userStatusLastUpdated.next(Date.now());
    this._status.next('LOGGED_IN');
    info(`[VRChat] Logged in: ${this._user.value?.displayName}`);
  }

  public async logout() {
    this.cancelSessionRestore();
    await this.api.clearCaches();
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

  private async getCurrentUserAfter2FA(): Promise<CurrentUser> {
    try {
      return await this.api.getCurrentUser(undefined, true);
    } catch (e) {
      if (
        e === 'INVALID_CREDENTIALS' ||
        e === 'MISSING_CREDENTIALS' ||
        e === 'CHECK_EMAIL' ||
        e === 'UNSUPPORTED_2FA_METHOD' ||
        e === '2FA_TOTP_REQUIRED' ||
        e === '2FA_EMAILOTP_REQUIRED'
      ) {
        throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, CURRENT_USER_RETRY_DELAY));
      return await this.api.getCurrentUser(undefined, true);
    }
  }

  // user state

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

  // credentials

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
