import { error, info, warn } from '@tauri-apps/plugin-log';
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
import {
  getActiveVRChatProfile,
  VRChatAccountProfile,
  VRChatApiSettings,
} from 'src-ui/app/models/vrchat-api-settings';
import {
  adoptVRChatProfileIdentity,
  createVRChatDraftProfile,
  createVRChatProfileAttempt,
  getVRChatProfileAttemptSource,
  patchVRChatProfile,
  pruneVRChatDraftProfiles,
  removeVRChatProfile,
  setActiveVRChatProfile,
  VRChatProfileSessionPatch,
} from './vrchat-profiles';

export type VRChatAuthStatus = 'PRE_INIT' | 'LOGGED_OUT' | 'LOGGED_IN';

type SessionRestoreResult =
  | { status: 'NONE' | 'RETRY' }
  | { status: 'RESTORED'; user: CurrentUser }
  | { status: 'LOGIN_REQUIRED'; error?: string }
  | {
      status: 'TEMPORARILY_REJECTED';
      error: string;
      loginIdentifier?: string;
      sourceProfileId?: string;
    }
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
    'PROFILE_MISMATCH',
    'AUTHENTICATION_REJECTED',
  ].includes(String(cause));
}

function requiresSessionReauthentication(cause: unknown): boolean {
  return [
    'INVALID_CREDENTIALS',
    'MISSING_CREDENTIALS',
    'CHECK_EMAIL',
    'UNSUPPORTED_2FA_METHOD',
    '2FA_TOTP_REQUIRED',
    '2FA_EMAILOTP_REQUIRED',
    'PROFILE_MISMATCH',
    'AUTHENTICATION_REJECTED',
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
  private transition: Promise<void> = Promise.resolve();
  private readonly suspendedSessions = new Map<string, { profileId: string; user: CurrentUser }>();

  public readonly status = this.statusSubject.asObservable();
  public readonly user = this.userSubject.asObservable();

  constructor(
    private readonly api: VRChatAPI,
    private readonly modalService: ModalService,
    private readonly mutateSettings: (
      mutator: (settings: VRChatApiSettings) => VRChatApiSettings
    ) => Promise<VRChatApiSettings>,
    private readonly settings: Observable<VRChatApiSettings>
  ) {}

  // session restoration

  public async init(): Promise<void> {
    const active = await this.getActiveProfile();
    const resumedAttempt = active?.draft ? active : null;
    if (active && !active.draft) {
      await this.mutateSettings((settings) => createVRChatProfileAttempt(settings, active.id));
    }
    let restoreResult = await this.loadSession();
    if (
      (restoreResult.status === 'NONE' || restoreResult.status === 'RETRY') &&
      resumedAttempt?.restoreProfileId
    ) {
      await this.restoreProfileAttempt(resumedAttempt);
      const restored = await this.getActiveProfile();
      if (restored?.authCookie && !restored.draft) {
        await this.mutateSettings((settings) => createVRChatProfileAttempt(settings, restored.id));
        restoreResult = await this.loadSession();
      }
    }
    if (restoreResult.status === 'RESTORED') {
      try {
        await this.completeLogin(restoreResult.user);
      } catch (cause) {
        error(`[VRChat] Failed to complete restored login: ${cause}`);
        restoreResult = { status: 'LOGIN_REQUIRED', error: 'UNEXPECTED_RESPONSE' };
      }
    }
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
    const savedProfile = await this.getActiveProfile();
    if (!savedProfile?.authCookie) {
      return { status: 'NONE' };
    }
    try {
      const user = await this.api.getCurrentUser({
        signal,
        expectedUserId: savedProfile.userId ?? undefined,
      });
      if (savedProfile.userId && savedProfile.userId !== user.id) {
        await this.patchActiveProfile({ authCookie: null });
        return { status: 'LOGIN_REQUIRED', error: 'PROFILE_MISMATCH' };
      }
      if (savedProfile.pendingTwoFactorLoginIdentifier) {
        await this.patchActiveProfile({ pendingTwoFactorLoginIdentifier: null });
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
          info(`[VRChat] Failed to restore session: ${e}`);
          return { status: 'LOGIN_REQUIRED' };
        case 'UNSUPPORTED_2FA_METHOD':
        case 'PROFILE_MISMATCH':
          info(`[VRChat] Failed to restore session: ${e}`);
          return { status: 'LOGIN_REQUIRED', error: String(e) };
        case 'CHECK_EMAIL':
        case 'AUTHENTICATION_REJECTED':
          info(`[VRChat] Failed to restore session: ${e}`);
          return {
            status: 'TEMPORARILY_REJECTED',
            error: String(e === 'CHECK_EMAIL' ? e : 'UNEXPECTED_RESPONSE'),
            loginIdentifier: await this.loadPendingTwoFactorLoginIdentifier(),
            sourceProfileId: savedProfile.sourceProfileId ?? undefined,
          };
        default:
          error(`[VRChat] Error trying to restore session: ${e}`);
          return { status: 'RETRY' };
      }
    }
  }

  private handleSessionRestoreResult(result: SessionRestoreResult): void {
    switch (result.status) {
      case 'TWO_FACTOR_REQUIRED':
        this.showLoginModal(
          false,
          result.method,
          undefined,
          result.loginIdentifier,
          false,
          undefined,
          true
        );
        break;
      case 'LOGIN_REQUIRED':
        info(`[VRChat] Login expired.`);
        this.showLoginModal(true, undefined, result.error, undefined, false, undefined, true);
        this.scheduleSessionRestore();
        break;
      case 'TEMPORARILY_REJECTED':
        this.showLoginModal(
          false,
          undefined,
          result.error,
          result.loginIdentifier,
          false,
          result.sourceProfileId,
          true
        );
        this.scheduleSessionRestore();
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
      let result = await restore.catch((e) => {
        error(`[VRChat] Error trying to restore session: ${e}`);
        return { status: 'RETRY' } as SessionRestoreResult;
      });
      if (this.sessionRestoreInFlight === restore) this.sessionRestoreInFlight = undefined;
      if (this.sessionRestoreAbortController === abortController) {
        this.sessionRestoreAbortController = undefined;
      }
      if (generation !== this.sessionRestoreGeneration) return;
      if (result.status === 'RESTORED') {
        const user = result.user;
        try {
          await this.queueTransition(async () => {
            if (generation !== this.sessionRestoreGeneration) return;
            await this.completeLogin(user);
            this.modalService.closeModal(LOGIN_MODAL_ID);
          });
        } catch (cause) {
          error(`[VRChat] Failed to complete restored login: ${cause}`);
          result = { status: 'LOGIN_REQUIRED', error: 'UNEXPECTED_RESPONSE' };
        }
      }
      if (generation !== this.sessionRestoreGeneration) return;
      this.handleSessionRestoreResult(result);
    }, SESSION_RESTORE_RETRY_DELAY);
  }

  private cancelSessionRestore(): void {
    this.sessionRestoreGeneration++;
    clearTimeout(this.sessionRestoreRetry);
    this.sessionRestoreRetry = undefined;
    this.sessionRestoreInFlight = undefined;
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
    username?: string,
    newAccount = false,
    restoreProfileIdOnCancel?: string,
    keepActiveProfile = false
  ): void {
    if (this.modalService.isModalOpen(LOGIN_MODAL_ID)) return;
    this.modalService
      .addModal(
        VRChatLoginModalComponent,
        {
          autoLogin,
          newAccount,
          keepActiveProfile,
          twoFactorMethod,
          initialError,
          ...(username ? { username } : {}),
        },
        {
          closeOnEscape: false,
          id: LOGIN_MODAL_ID,
        }
      )
      .subscribe(() => {
        void this.queueTransition(() => this.finishLoginModal(restoreProfileIdOnCancel));
      });
  }

  private async finishLoginModal(restoreProfileIdOnCancel?: string): Promise<void> {
    this.cancelSessionRestore();
    const incompleteProfile = !this.userSubject.value
      ? await this.getActiveProfile().then((profile) => (profile?.draft ? profile : null))
      : null;
    if (incompleteProfile) {
      const settings = await firstValueFrom(this.settings);
      if (!getVRChatProfileAttemptSource(settings, incompleteProfile)) {
        await this.api
          .logoutProfile(incompleteProfile.id)
          .catch((cause) => warn(`[VRChat] Failed to invalidate cancelled login: ${cause}`));
      }
      await this.restoreProfileAttempt(incompleteProfile, restoreProfileIdOnCancel).catch((cause) =>
        error(`[VRChat] Failed to restore the previous profile: ${cause}`)
      );
    } else {
      await this.mutateSettings(pruneVRChatDraftProfiles).catch((cause) =>
        error(`[VRChat] Failed to clean up login profiles: ${cause}`)
      );
    }
  }

  public async login(username: string, password: string, keepActiveProfile = false): Promise<void> {
    if (this.statusSubject.value !== 'LOGGED_OUT')
      throw new Error('Tried calling login() while already logged in');
    this.cancelSessionRestore();
    this.pendingTwoFactorLoginIdentifierHash = undefined;
    const loginIdentifierHash = await hashLoginIdentifier(username);
    if (!keepActiveProfile) await this.selectLoginProfile(loginIdentifierHash);
    await this.patchActiveProfile({ pendingTwoFactorLoginIdentifier: null });
    const savedProfile = await this.requireActiveProfile();
    const rememberedCredentials = savedProfile.twoFactorCookieLoginIdentifierHash
      ? null
      : await this.loadCredentials();
    const rememberedLoginIdentifierHash = rememberedCredentials
      ? await hashLoginIdentifier(rememberedCredentials.username)
      : null;
    const reuseTwoFactorCookie =
      !!savedProfile.twoFactorCookie &&
      (savedProfile.twoFactorCookieLoginIdentifierHash === loginIdentifierHash ||
        (rememberedLoginIdentifierHash === loginIdentifierHash &&
          rememberedCredentials?.password === password));
    await this.api.clearCaches();
    let user: CurrentUser;
    try {
      user = await this.api.getCurrentUser({
        credentials: { username, password },
        includeTwoFactorCookie: reuseTwoFactorCookie,
        expectedUserId: savedProfile.userId ?? undefined,
      });
    } catch (cause) {
      if (twoFactorMethodFromError(cause)) {
        this.pendingTwoFactorLoginIdentifierHash = loginIdentifierHash;
        await this.patchActiveProfile({
          twoFactorCookieLoginIdentifierHash: loginIdentifierHash,
          pendingTwoFactorLoginIdentifier: username,
        });
      }
      throw cause;
    }
    this.pendingTwoFactorLoginIdentifierHash = undefined;
    const currentProfile = await this.requireActiveProfile();
    if (
      !reuseTwoFactorCookie &&
      savedProfile.twoFactorCookie &&
      currentProfile.twoFactorCookie === savedProfile.twoFactorCookie
    ) {
      await this.clearTwoFactorCookie();
    } else if (currentProfile.twoFactorCookie) {
      await this.patchActiveProfile({ twoFactorCookieLoginIdentifierHash: loginIdentifierHash });
    }
    await this.patchActiveProfile({ pendingTwoFactorLoginIdentifier: null });
    await this.completeLogin(user);
  }

  public loginNewAccount(username: string, password: string): Promise<void> {
    return this.queueTransition(async () => {
      const previousProfile = await this.getActiveProfile();
      if (previousProfile?.draft && !previousProfile.sourceProfileId) {
        await this.login(username, password, true);
        return;
      }
      const previousUser = this.userSubject.value;
      await this.deactivate();
      let settings: VRChatApiSettings;
      try {
        settings = await this.mutateSettings((settings) =>
          createVRChatDraftProfile(pruneVRChatDraftProfiles(settings))
        );
      } catch (cause) {
        if (previousUser) {
          this.setCurrentUser(previousUser);
          this.statusSubject.next('LOGGED_IN');
        }
        throw cause;
      }
      if (previousProfile && previousUser && settings.activeProfileId) {
        this.suspendedSessions.set(settings.activeProfileId, {
          profileId: previousProfile.id,
          user: previousUser,
        });
      }
      await this.login(username, password, true);
    });
  }

  public async verify2FA(code: string, method: VRChatTwoFactorMethod): Promise<void> {
    if (this.statusSubject.value !== 'LOGGED_OUT') {
      error(`[VRChat] Tried calling verify2FA() while already logged in`);
      throw new Error('Tried calling verify2FA() while already logged in');
    }
    this.cancelSessionRestore();
    await this.api.clearCaches();
    const { authCookie } = await this.requireActiveProfile();
    if (!authCookie) throw new Error('Called verify2FA() before successfully calling login()');
    await this.api.verify2FA(code, method);
    await this.patchActiveProfile({
      pendingTwoFactorLoginIdentifier: null,
      ...(this.pendingTwoFactorLoginIdentifierHash
        ? { twoFactorCookieLoginIdentifierHash: this.pendingTwoFactorLoginIdentifierHash }
        : {}),
    });
    this.pendingTwoFactorLoginIdentifierHash = undefined;
    let user: CurrentUser;
    try {
      user = await this.getCurrentUserAfter2FA();
    } catch (cause) {
      this.scheduleSessionRestore();
      throw cause;
    }
    await this.completeLogin(user);
  }

  public logout(): Promise<void> {
    return this.queueTransition(() => this.disconnect());
  }

  private async disconnect(): Promise<void> {
    await this.deactivate();
    await this.mutateSettings((settings) =>
      pruneVRChatDraftProfiles(setActiveVRChatProfile(settings, null))
    );
    info(`[VRChat] Disconnected`);
  }

  public activateProfile(profileId: string): Promise<void> {
    return this.queueTransition(() => this.activateProfileNow(profileId));
  }

  private async activateProfileNow(profileId: string, force = false): Promise<void> {
    const current = await this.getActiveProfile();
    if (!force && current?.id === profileId && this.statusSubject.value === 'LOGGED_IN') return;
    const previousUser = this.userSubject.value;
    await this.deactivate();
    let settings: VRChatApiSettings;
    try {
      settings = await this.mutateSettings((settings) =>
        createVRChatProfileAttempt(pruneVRChatDraftProfiles(settings), profileId)
      );
    } catch (cause) {
      if (previousUser) {
        this.setCurrentUser(previousUser);
        this.statusSubject.next('LOGGED_IN');
      }
      throw cause;
    }
    const attempt = getActiveVRChatProfile(settings);
    if (!attempt) throw new Error('Failed to create VRChat profile attempt');
    if (current && previousUser) {
      this.suspendedSessions.set(attempt.id, { profileId: current.id, user: previousUser });
    }
    const result = await this.loadSession();
    if (result.status === 'RESTORED') {
      await this.completeLogin(result.user);
      return;
    }
    const restoreProfileIdOnCancel =
      this.suspendedSessions.get(attempt.id)?.profileId ?? attempt.sourceProfileId ?? undefined;
    if (result.status === 'TWO_FACTOR_REQUIRED') {
      this.showLoginModal(
        false,
        result.method,
        undefined,
        result.loginIdentifier,
        false,
        restoreProfileIdOnCancel,
        true
      );
      return;
    }
    if (result.status === 'RETRY') {
      if (this.suspendedSessions.has(attempt.id)) {
        await this.restoreProfileAttempt(attempt, restoreProfileIdOnCancel);
        return;
      }
      this.handleSessionRestoreResult(result);
      return;
    }
    if (result.status === 'TEMPORARILY_REJECTED') {
      this.handleSessionRestoreResult(result);
      return;
    }
    const credentials = await this.loadCredentials();
    if (credentials) {
      try {
        await this.login(credentials.username, credentials.password, true);
        return;
      } catch (cause) {
        const method = twoFactorMethodFromError(cause);
        const temporaryFailure =
          !method && !['INVALID_CREDENTIALS', 'PROFILE_MISMATCH'].includes(String(cause));
        if (temporaryFailure && this.suspendedSessions.has(attempt.id)) {
          await this.restoreProfileAttempt(attempt, restoreProfileIdOnCancel);
          return;
        }
        this.showLoginModal(
          false,
          method,
          method ? undefined : String(cause),
          credentials.username,
          false,
          restoreProfileIdOnCancel,
          true
        );
        if (temporaryFailure) this.scheduleSessionRestore();
        return;
      }
    }
    const profile = await this.requireActiveProfile();
    this.showLoginModal(
      false,
      undefined,
      result.status === 'LOGIN_REQUIRED' ? result.error : undefined,
      profile.username ?? undefined,
      false,
      restoreProfileIdOnCancel,
      true
    );
    this.scheduleSessionRestore();
  }

  public prepareNewLogin(): Promise<void> {
    return this.queueTransition(() => this.prepareNewLoginNow());
  }

  private async prepareNewLoginNow(): Promise<void> {
    const settings = await firstValueFrom(this.settings);
    const active = getActiveVRChatProfile(settings);
    const restoreProfileIdOnCancel = active?.draft
      ? (getVRChatProfileAttemptSource(settings, active)?.id ?? undefined)
      : active?.id;
    this.showLoginModal(false, undefined, undefined, undefined, true, restoreProfileIdOnCancel);
  }

  public removeProfile(profileId: string): Promise<void> {
    return this.queueTransition(async () => {
      const settings = await firstValueFrom(this.settings);
      const attempts = settings.profiles.filter(
        (profile) =>
          profile.draft &&
          (profile.sourceProfileId === profileId || profile.restoreProfileId === profileId)
      );
      const active = getActiveVRChatProfile(settings);
      if (active?.id === profileId || attempts.some((attempt) => attempt.id === active?.id)) {
        await this.deactivate();
      }
      await this.api
        .logoutProfile(profileId)
        .catch((cause) => warn(`[VRChat] Failed to invalidate removed profile: ${cause}`));
      await this.mutateSettings((currentSettings) => {
        let updated = currentSettings;
        for (const attempt of attempts) updated = removeVRChatProfile(updated, attempt.id);
        return removeVRChatProfile(updated, profileId);
      });
      for (const attempt of attempts) this.suspendedSessions.delete(attempt.id);
    });
  }

  private queueTransition(action: () => Promise<void>): Promise<void> {
    const transition = this.transition.then(action, action);
    this.transition = transition.catch(() => undefined);
    return transition;
  }

  private async deactivate(): Promise<void> {
    this.cancelSessionRestore();
    this.pendingTwoFactorLoginIdentifierHash = undefined;
    this.lastUserUpdateAt = 0;
    this.lastStatusUpdateAt = 0;
    this.userSubject.next(null);
    this.statusSubject.next('LOGGED_OUT');
    await this.api.clearCaches();
  }

  private async completeLogin(user: CurrentUser): Promise<void> {
    const active = await this.requireActiveProfile();
    if (active.userId && active.userId !== user.id) {
      await this.patchActiveProfile({ authCookie: null });
      throw 'PROFILE_MISMATCH';
    }
    await this.mutateSettings((settings) => adoptVRChatProfileIdentity(settings, user));
    this.suspendedSessions.delete(active.id);
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
    await this.patchActiveProfile({
      twoFactorCookie: null,
      ...(clearLoginIdentifier ? { twoFactorCookieLoginIdentifierHash: null } : {}),
    });
  }

  private async getActiveProfile(): Promise<VRChatAccountProfile | null> {
    return getActiveVRChatProfile(await firstValueFrom(this.settings));
  }

  private async requireActiveProfile(): Promise<VRChatAccountProfile> {
    const profile = await this.getActiveProfile();
    if (!profile) throw new Error('VRChat authentication requires an active profile');
    return profile;
  }

  private async patchActiveProfile(patch: VRChatProfileSessionPatch): Promise<void> {
    const profile = await this.requireActiveProfile();
    await this.mutateSettings((settings) => patchVRChatProfile(settings, profile.id, patch));
  }

  private async selectLoginProfile(loginIdentifierHash: string): Promise<void> {
    await this.mutateSettings((settings) => {
      const matching = settings.profiles.find(
        (profile) =>
          !profile.draft && profile.twoFactorCookieLoginIdentifierHash === loginIdentifierHash
      );
      if (matching) {
        return createVRChatProfileAttempt(pruneVRChatDraftProfiles(settings), matching.id);
      }
      const active = getActiveVRChatProfile(settings);
      return active && !active.userId
        ? settings
        : createVRChatDraftProfile(pruneVRChatDraftProfiles(settings));
    });
  }

  private async restoreProfileAttempt(
    attempt: VRChatAccountProfile,
    fallbackProfileId?: string
  ): Promise<boolean> {
    const suspended = this.suspendedSessions.get(attempt.id);
    const settings = await firstValueFrom(this.settings);
    const source = getVRChatProfileAttemptSource(settings, attempt);
    const profileId =
      suspended?.profileId ?? attempt.restoreProfileId ?? source?.id ?? fallbackProfileId;
    await this.mutateSettings((currentSettings) => {
      const pruned = pruneVRChatDraftProfiles(currentSettings);
      return profileId && pruned.profiles.some((profile) => profile.id === profileId)
        ? setActiveVRChatProfile(pruned, profileId)
        : setActiveVRChatProfile(pruned, null);
    });
    this.suspendedSessions.delete(attempt.id);
    if (!suspended) {
      this.userSubject.next(null);
      this.statusSubject.next('LOGGED_OUT');
      return false;
    }
    this.setCurrentUser(suspended.user);
    this.statusSubject.next('LOGGED_IN');
    info(`[VRChat] Restored previous account after unsuccessful login attempt`);
    return true;
  }

  private async loadPendingTwoFactorLoginIdentifier(): Promise<string | undefined> {
    return (await this.requireActiveProfile()).pendingTwoFactorLoginIdentifier ?? undefined;
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
        Date.now() - this.lastUserUpdateAt > SOCKET_UPDATE_HEALTH_WINDOW ||
        Date.now() - this.lastStatusUpdateAt > STATUS_FRESHNESS_WINDOW;
      if (!needsPolling) return;
      await this.revalidateSession();
    });
  }

  public async revalidateSession(): Promise<void> {
    if (this.statusSubject.value !== 'LOGGED_IN') return;
    let polledProfileId: string | undefined;
    try {
      const active = await this.getActiveProfile();
      polledProfileId = active?.id;
      const result = await this.api.pollCurrentUser(active?.userId ?? undefined);
      if (result.error) throw result.error;
      if (result.result) this.patchCurrentUser(result.result);
    } catch (cause) {
      error(`[VRChat] Error polling user: ${JSON.stringify(cause)}`);
      if (!requiresSessionReauthentication(cause)) return;
      await this.queueTransition(async () => {
        if (this.statusSubject.value !== 'LOGGED_IN') return;
        const active = await this.getActiveProfile();
        if (!active || active.draft || active.id !== polledProfileId) return;
        await this.activateProfileNow(active.id, true);
      }).catch((recoveryCause) =>
        error(`[VRChat] Failed to recover expired session: ${recoveryCause}`)
      );
    }
  }

  // remembered credentials

  public async rememberCredentials(username: string, password: string): Promise<void> {
    await this.patchActiveProfile({
      rememberedCredentials: { username, password },
      rememberCredentials: true,
    });
  }

  public async forgetCredentials(): Promise<void> {
    const profile = await this.getActiveProfile();
    if (!profile) return;
    await this.mutateSettings((settings) =>
      patchVRChatProfile(settings, profile.id, {
        rememberedCredentials: null,
        rememberCredentials: false,
      })
    );
  }

  public async loadCredentials(): Promise<{ username: string; password: string } | null> {
    const rememberedCredentials = (await this.getActiveProfile())?.rememberedCredentials;
    return rememberedCredentials ? { ...rememberedCredentials } : null;
  }
}
