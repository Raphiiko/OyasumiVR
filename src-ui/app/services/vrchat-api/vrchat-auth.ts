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
  | {
      status: 'TWO_FACTOR_REQUIRED';
      method: VRChatTwoFactorMethod;
      loginIdentifier?: string;
    };

const LOGIN_MODAL_ID = 'VRCHAT_LOGIN';
const SESSION_RESTORE_RETRY_DELAY = 60_000;
const CURRENT_USER_RETRY_DELAY = 1_000;
const STATUS_POLL_INTERVAL = 60_000;
const SOCKET_UPDATE_HEALTH_WINDOW = 60 * 60_000;
const STATUS_FRESHNESS_WINDOW = 10 * 60_000;

function shouldRetryCurrentUserRequest(cause: unknown): boolean {
  return ![
    'INVALID_CREDENTIALS',
    'MISSING_CREDENTIALS',
    'CHECK_EMAIL',
    'UNSUPPORTED_2FA_METHOD',
    '2FA_TOTP_REQUIRED',
    '2FA_EMAILOTP_REQUIRED',
  ].includes(String(cause));
}

async function hashLoginIdentifier(identifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identifier.trim().toLowerCase())
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class VRChatAuth {
  private readonly statusSubject = new BehaviorSubject<VRChatAuthStatus>('PRE_INIT');
  private readonly userSubject = new BehaviorSubject<CurrentUser | null>(null);
  private sessionRestoreRetry?: ReturnType<typeof setTimeout>;
  private sessionRestoreInFlight?: Promise<SessionRestoreResult>;
  private sessionRestoreAbortController?: AbortController;
  /** Changes whenever pending session restoration must be discarded. */
  private sessionRestoreGeneration = 0;
  private pendingTwoFactorLoginIdentifierHash?: string;
  private lastUserUpdateAt = 0;
  private lastStatusUpdateAt = 0;

  public readonly status = this.statusSubject.asObservable();
  public readonly user = this.userSubject.asObservable();

  constructor(
    private readonly api: VRChatAPI,
    private readonly modalService: ModalService,
    private readonly updateSettings: (settings: Partial<VRChatApiSettings>) => Promise<void>,
    private readonly settings: Observable<VRChatApiSettings>
  ) {}

  // session restoration

  public async init(): Promise<void> {
    const restoreResult = await this.loadSession();
    if (restoreResult.status === 'RESTORED') this.setCurrentUser(restoreResult.user);
    this.statusSubject.next(this.userSubject.value ? 'LOGGED_IN' : 'LOGGED_OUT');
    this.handleSessionRestoreResult(restoreResult);
    this.startStatusPolling();
    this.userSubject
      .pipe(
        debounceTime(500),
        distinctUntilChanged((prev, curr) => prev?.id === curr?.id)
      )
      .subscribe((user) => {
        if (user) {
          void this.api
            .listFriends()
            .catch((e) => error(`[VRChat] Failed to preload friends: ${JSON.stringify(e)}`));
        }
      });
  }

  private async loadSession(signal?: AbortSignal): Promise<SessionRestoreResult> {
    const savedSettings = await firstValueFrom(this.settings);
    if (!savedSettings.authCookie) {
      if (savedSettings.encryptedPendingTwoFactorLoginIdentifier) {
        await this.updateSettings({ encryptedPendingTwoFactorLoginIdentifier: null });
      }
      return { status: 'NONE' };
    }
    try {
      const user = await this.api.getCurrentUser({ signal });
      if (savedSettings.encryptedPendingTwoFactorLoginIdentifier) {
        await this.updateSettings({ encryptedPendingTwoFactorLoginIdentifier: null });
      }
      info(`[VRChat] Restored existing session`);
      return { status: 'RESTORED', user };
    } catch (e) {
      if (signal?.aborted) return { status: 'RETRY' };
      const method = twoFactorMethodFromError(e);
      if (method)
        return {
          status: 'TWO_FACTOR_REQUIRED',
          method,
          loginIdentifier: await this.loadPendingTwoFactorLoginIdentifier(),
        };
      switch (e) {
        case 'INVALID_CREDENTIALS':
        case 'MISSING_CREDENTIALS':
          await this.api.clearCaches();
          if (signal?.aborted) return { status: 'RETRY' };
          await this.updateSettings({
            authCookie: null,
            encryptedPendingTwoFactorLoginIdentifier: null,
          });
          info(`[VRChat] Failed to restore session: ${e}`);
          return { status: 'LOGIN_REQUIRED' };
        case 'CHECK_EMAIL':
        case 'UNSUPPORTED_2FA_METHOD':
          await this.updateSettings({ encryptedPendingTwoFactorLoginIdentifier: null });
          info(`[VRChat] Failed to restore session: ${e}`);
          return { status: 'LOGIN_REQUIRED', error: String(e) };
        case 'AUTHENTICATION_REJECTED':
          await this.updateSettings({ encryptedPendingTwoFactorLoginIdentifier: null });
          info(`[VRChat] Failed to restore session: ${e}`);
          return { status: 'LOGIN_REQUIRED', error: 'UNEXPECTED_RESPONSE' };
        default:
          error(`[VRChat] Error trying to restore session: ${e}`);
          return { status: 'RETRY' };
      }
    }
  }

  private handleSessionRestoreResult(result: SessionRestoreResult): void {
    switch (result.status) {
      case 'TWO_FACTOR_REQUIRED':
        this.showLoginModal(false, result.method, undefined, result.loginIdentifier);
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

  private scheduleSessionRestore(): void {
    if (this.sessionRestoreRetry || this.sessionRestoreInFlight) return;
    const generation = this.sessionRestoreGeneration;
    this.sessionRestoreRetry = setTimeout(async () => {
      this.sessionRestoreRetry = undefined;
      if (this.statusSubject.value !== 'LOGGED_OUT') return;
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
        this.setCurrentUser(result.user);
        this.statusSubject.next('LOGGED_IN');
        this.modalService.closeModal(LOGIN_MODAL_ID);
      }
      this.handleSessionRestoreResult(result);
    }, SESSION_RESTORE_RETRY_DELAY);
  }

  private cancelSessionRestore(): void {
    this.sessionRestoreGeneration++;
    clearTimeout(this.sessionRestoreRetry);
    this.sessionRestoreRetry = undefined;
    this.sessionRestoreAbortController?.abort();
    this.sessionRestoreAbortController = undefined;
  }

  private setCurrentUser(user: CurrentUser): void {
    this.userSubject.next(user);
    this.lastStatusUpdateAt = Date.now();
  }

  // authentication

  public showLoginModal(
    autoLogin = false,
    twoFactorMethod?: VRChatTwoFactorMethod,
    initialError?: string,
    username?: string
  ): void {
    if (this.modalService.isModalOpen(LOGIN_MODAL_ID)) return;
    this.modalService
      .addModal(
        VRChatLoginModalComponent,
        { autoLogin, twoFactorMethod, initialError, ...(username ? { username } : {}) },
        {
          closeOnEscape: false,
          id: LOGIN_MODAL_ID,
        }
      )
      .subscribe(() => {});
  }

  public async login(username: string, password: string): Promise<void> {
    if (this.statusSubject.value !== 'LOGGED_OUT')
      throw new Error('Tried calling login() while already logged in');
    this.cancelSessionRestore();
    this.pendingTwoFactorLoginIdentifierHash = undefined;
    await this.updateSettings({ encryptedPendingTwoFactorLoginIdentifier: null });
    const loginIdentifierHash = await hashLoginIdentifier(username);
    const savedSettings = await firstValueFrom(this.settings);
    const rememberedCredentials = savedSettings.twoFactorCookieLoginIdentifierHash
      ? null
      : await this.loadCredentials();
    const rememberedLoginIdentifierHash = rememberedCredentials
      ? await hashLoginIdentifier(rememberedCredentials.username)
      : null;
    const reuseTwoFactorCookie =
      !!savedSettings.twoFactorCookie &&
      (savedSettings.twoFactorCookieLoginIdentifierHash === loginIdentifierHash ||
        (rememberedLoginIdentifierHash === loginIdentifierHash &&
          rememberedCredentials?.password === password));
    await this.api.clearCaches();
    let user: CurrentUser;
    try {
      user = await this.api.getCurrentUser({
        credentials: { username, password },
        includeTwoFactorCookie: reuseTwoFactorCookie,
      });
    } catch (cause) {
      if (twoFactorMethodFromError(cause)) {
        this.pendingTwoFactorLoginIdentifierHash = loginIdentifierHash;
        await this.updateSettings({
          twoFactorCookie: null,
          twoFactorCookieLoginIdentifierHash: loginIdentifierHash,
          encryptedPendingTwoFactorLoginIdentifier:
            await this.encryptPendingTwoFactorLoginIdentifier(username),
        });
      }
      throw cause;
    }
    this.pendingTwoFactorLoginIdentifierHash = undefined;
    const currentSettings = await firstValueFrom(this.settings);
    if (
      !reuseTwoFactorCookie &&
      savedSettings.twoFactorCookie &&
      currentSettings.twoFactorCookie === savedSettings.twoFactorCookie
    ) {
      await this.clearTwoFactorCookie();
    } else if (currentSettings.twoFactorCookie) {
      await this.updateSettings({ twoFactorCookieLoginIdentifierHash: loginIdentifierHash });
    }
    await this.updateSettings({ encryptedPendingTwoFactorLoginIdentifier: null });
    this.completeLogin(user);
  }

  public async verify2FA(code: string, method: VRChatTwoFactorMethod): Promise<void> {
    if (this.statusSubject.value !== 'LOGGED_OUT') {
      error(`[VRChat] Tried calling verify2FA() while already logged in`);
      throw new Error('Tried calling verify2FA() while already logged in');
    }
    this.cancelSessionRestore();
    await this.api.clearCaches();
    const { authCookie } = await firstValueFrom(this.settings);
    if (!authCookie) throw new Error('Called verify2FA() before successfully calling login()');
    await this.clearTwoFactorCookie(this.pendingTwoFactorLoginIdentifierHash !== undefined);
    await this.api.verify2FA(code, method);
    await this.updateSettings({
      encryptedPendingTwoFactorLoginIdentifier: null,
      ...(this.pendingTwoFactorLoginIdentifierHash
        ? { twoFactorCookieLoginIdentifierHash: this.pendingTwoFactorLoginIdentifierHash }
        : {}),
    });
    this.pendingTwoFactorLoginIdentifierHash = undefined;
    this.completeLogin(await this.getCurrentUserAfter2FA());
  }

  public async logout(): Promise<void> {
    this.cancelSessionRestore();
    await this.api.clearCaches();
    await this.updateSettings({
      authCookie: null,
      twoFactorCookie: null,
      twoFactorCookieLoginIdentifierHash: null,
      encryptedPendingTwoFactorLoginIdentifier: null,
    });
    this.userSubject.next(null);
    this.statusSubject.next('LOGGED_OUT');
    info(`[VRChat] Logged out`);
  }

  private completeLogin(user: CurrentUser): void {
    this.setCurrentUser(user);
    this.statusSubject.next('LOGGED_IN');
    info(`[VRChat] Logged in: ${user.displayName}`);
  }

  private async getCurrentUserAfter2FA(): Promise<CurrentUser> {
    try {
      return await this.api.getCurrentUser();
    } catch (cause) {
      if (!shouldRetryCurrentUserRequest(cause)) throw cause;
      await new Promise((resolve) => setTimeout(resolve, CURRENT_USER_RETRY_DELAY));
      return await this.api.getCurrentUser();
    }
  }

  private async clearTwoFactorCookie(clearLoginIdentifier = true): Promise<void> {
    await this.updateSettings({
      twoFactorCookie: null,
      ...(clearLoginIdentifier ? { twoFactorCookieLoginIdentifierHash: null } : {}),
    });
  }

  private async encryptPendingTwoFactorLoginIdentifier(identifier: string): Promise<string | null> {
    const { credentialCryptoKey } = await firstValueFrom(this.settings);
    if (!credentialCryptoKey) return null;
    try {
      const key = await deserializeStorageCryptoKey(credentialCryptoKey);
      return await encryptStorageData(identifier, key);
    } catch (e) {
      error('[VRChat] Failed to encrypt pending login identifier: ' + JSON.stringify(e));
      return null;
    }
  }

  private async loadPendingTwoFactorLoginIdentifier(): Promise<string | undefined> {
    const { credentialCryptoKey, encryptedPendingTwoFactorLoginIdentifier } = await firstValueFrom(
      this.settings
    );
    if (!credentialCryptoKey || !encryptedPendingTwoFactorLoginIdentifier) return undefined;
    try {
      const key = await deserializeStorageCryptoKey(credentialCryptoKey);
      return await decryptStorageData(encryptedPendingTwoFactorLoginIdentifier, key);
    } catch (e) {
      error('[VRChat] Failed to decrypt pending login identifier: ' + JSON.stringify(e));
      await this.updateSettings({ encryptedPendingTwoFactorLoginIdentifier: null });
      return undefined;
    }
  }

  // user state

  public patchCurrentUser(user: Partial<CurrentUser>): void {
    const currentUser = structuredClone(this.userSubject.value);
    if (!currentUser) return;
    Object.assign(currentUser, user);
    this.userSubject.next(currentUser);
    if (user.status) this.lastStatusUpdateAt = Date.now();
  }

  /** Marks socket updates as healthy so status polling can stand down. */
  public receivedUserUpdate(user: Partial<CurrentUser>): void {
    this.patchCurrentUser(user);
    this.lastUserUpdateAt = Date.now();
  }

  private startStatusPolling(): void {
    interval(STATUS_POLL_INTERVAL).subscribe(async () => {
      if (this.statusSubject.value !== 'LOGGED_IN') return;
      const needsPolling =
        Date.now() - this.lastUserUpdateAt > SOCKET_UPDATE_HEALTH_WINDOW &&
        Date.now() - this.lastStatusUpdateAt > STATUS_FRESHNESS_WINDOW;
      if (!needsPolling) return;
      try {
        const result = await this.api.pollCurrentUser();
        if (result.error) throw result.error;
        if (result.result) this.patchCurrentUser(result.result);
      } catch (e) {
        error(`[VRChat] Error polling user: ${JSON.stringify(e)}`);
      }
    });
  }

  // remembered credentials

  public async rememberCredentials(username: string, password: string): Promise<void> {
    const credentialCryptoKey = (await firstValueFrom(this.settings)).credentialCryptoKey;
    if (!credentialCryptoKey) return;
    let key: CryptoKey;
    try {
      key = await deserializeStorageCryptoKey(credentialCryptoKey);
    } catch (e) {
      error('[VRChat] Failed to deserialize storage crypto key: ' + JSON.stringify(e));
      await this.cycleCredentialCryptoKey();
      return;
    }
    const credentials = btoa(username) + ':' + btoa(password);
    const encryptedCredentials = await encryptStorageData(credentials, key);
    await this.updateSettings({
      rememberedCredentials: encryptedCredentials,
      rememberCredentials: true,
    });
  }

  public async forgetCredentials(): Promise<void> {
    await this.updateSettings({
      rememberedCredentials: null,
      rememberCredentials: false,
    });
  }

  public async loadCredentials(): Promise<{ username: string; password: string } | null> {
    const { credentialCryptoKey, rememberedCredentials } = await firstValueFrom(this.settings);
    if (!credentialCryptoKey || !rememberedCredentials) return null;
    let key: CryptoKey;
    try {
      key = await deserializeStorageCryptoKey(credentialCryptoKey);
    } catch (e) {
      error('[VRChat] Failed to deserialize storage crypto key: ' + JSON.stringify(e));
      await this.cycleCredentialCryptoKey();
      return null;
    }
    let credentials: string;
    try {
      credentials = await decryptStorageData(rememberedCredentials, key);
      const [username, password] = credentials.split(':').map((c) => atob(c));
      return { username, password };
    } catch (e) {
      error('[VRChat] Failed to decrypt remembered credentials: ' + JSON.stringify(e));
      await this.cycleCredentialCryptoKey();
      return null;
    }
  }

  private async cycleCredentialCryptoKey(): Promise<void> {
    info('[VRChat] Cycling the storage crypto key');
    await this.updateSettings({
      rememberedCredentials: null,
      rememberCredentials: false,
      encryptedPendingTwoFactorLoginIdentifier: null,
      credentialCryptoKey: await serializeStorageCryptoKey(await generateStorageCryptoKey()),
    });
  }
}
