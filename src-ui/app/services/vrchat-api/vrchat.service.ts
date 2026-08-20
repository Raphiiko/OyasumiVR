import { inject, Injectable } from '@angular/core';
import type { CurrentUser, LimitedUserFriend, Notification, LimitedUserGroups } from 'vrchat';
import { SETTINGS_KEY_VRCHAT_API, SETTINGS_STORE } from '../../globals';
import {
  getVRChatAccountSecret,
  getActiveVRChatProfile,
  normalizeVRChatAccountProfile,
  parseVRChatAccountSecret,
  VRCHAT_ACCOUNT_SECRET_EMPTY,
  VRCHAT_API_SETTINGS_DEFAULT,
  VRChatAccountProfile,
  VRChatAccountSecret,
  VRChatApiSettings,
} from '../../models/vrchat-api-settings';
import { migrateVRChatApiSettings } from '../../migrations/vrchat-api-settings.migrations';
import { BehaviorSubject, combineLatest, filter, firstValueFrom, map, Observable } from 'rxjs';
import { ModalService } from 'src-ui/app/services/modal.service';
import { AvatarEx, UserStatus, WorldContext } from '../../models/vrchat';
import { VRChatLogService } from '../vrchat-log.service';
import {
  decryptStorageData,
  deserializeStorageCryptoKey,
} from '../../migrations/legacy/storage-crypto';
import { protectSecret, unprotectSecret } from '../../utils/secrets';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { VRChatAPI, VRChatTwoFactorMethod } from './vrchat-api';
import { VRChatAuth, VRChatAuthStatus } from './vrchat-auth';
import { VRChatSocket } from './vrchat-socket';
import { error } from '@tauri-apps/plugin-log';
import type {
  VRChatOnLocationChangeEvent,
  VRChatOnPlayerJoinedEvent,
  VRChatOnPlayerLeftEvent,
} from '../../models/vrchat-log-event';
import type { VRChatSocketStatus } from './vrchat-socket';
import { ErrorReportingService } from '../error-reporting.service';
import {
  normalizeVRChatProfiles,
  patchVRChatProfile,
  VRChatProfileSessionPatch,
} from './vrchat-profiles';

function toPublicProfile(profile: VRChatAccountProfile): VRChatAccountProfile {
  return {
    ...profile,
    protectedSecret: null,
    authCookie: null,
    twoFactorCookie: null,
    twoFactorCookieLoginIdentifierHash: null,
    pendingTwoFactorLoginIdentifier: null,
    rememberedCredentials: null,
  };
}

@Injectable({
  providedIn: 'root',
})
export class VRChatService {
  private readonly modalService = inject(ModalService);
  private readonly logService = inject(VRChatLogService);
  private readonly errorReporting = inject(ErrorReportingService);

  private readonly settingsSubject = new BehaviorSubject<VRChatApiSettings>({
    ...VRCHAT_API_SETTINGS_DEFAULT,
  });
  private readonly vrchatProcessActiveSubject = new BehaviorSubject(false);
  private readonly worldSubject = new BehaviorSubject<WorldContext>({
    loaded: false,
    players: [],
  });

  private readonly api: VRChatAPI;
  private readonly auth: VRChatAuth;
  private readonly socket: VRChatSocket;
  private settingsUpdate: Promise<void> = Promise.resolve();
  private readonly failedLegacyProfiles = new Map<string, Record<string, unknown>>();
  private failedLegacyCredentialCryptoKey: string | null = null;
  private lockedActiveProfileId: string | null = null;

  private readonly settings = this.settingsSubject.asObservable();
  public readonly profiles = this.settings.pipe(
    map((settings) => settings.profiles.filter((profile) => !profile.draft).map(toPublicProfile))
  );
  public readonly activeProfile = this.settings.pipe(
    map((settings) => {
      const profile = getActiveVRChatProfile(settings);
      return profile ? toPublicProfile(profile) : null;
    })
  );
  public readonly user: Observable<CurrentUser | null>;
  public readonly status: Observable<VRChatAuthStatus>;
  public readonly notifications: Observable<Notification>;
  public readonly isFetchingFriends: Observable<boolean>;
  public readonly vrchatProcessActive = this.vrchatProcessActiveSubject.asObservable();
  public readonly world: Observable<WorldContext> = combineLatest([
    this.worldSubject,
    this.logService.initialLoadComplete.pipe(filter((complete) => complete)),
  ]).pipe(map(([world]) => world));
  public readonly websocketStatus: Observable<VRChatSocketStatus>;

  constructor() {
    const reportError = (cause: Error) => this.errorReporting.captureException(cause);
    this.api = new VRChatAPI(this.settings, this.updateProfile.bind(this), reportError);
    this.auth = new VRChatAuth(
      this.api,
      this.modalService,
      this.mutateSettings.bind(this),
      this.settings
    );
    this.api.setAuthenticationFailureHandler(() => void this.auth.revalidateSession());
    this.socket = new VRChatSocket(this.auth, this.api, this.settings, reportError);
    this.user = this.auth.user;
    this.status = this.auth.status;
    this.notifications = this.socket.notifications;
    this.isFetchingFriends = this.api.isFetchingFriends;
    this.websocketStatus = this.socket.status;
  }

  public async init(): Promise<void> {
    await this.loadSettings();
    await this.api.init(this.auth.user, this.auth.patchCurrentUser.bind(this.auth));
    await this.auth.init();
    this.socket.init();
    this.subscribeToLogEvents();
    await this.watchVRChatProcess();
  }

  private async watchVRChatProcess(): Promise<void> {
    await listen<boolean>('VRCHAT_PROCESS_ACTIVE', (event) =>
      this.vrchatProcessActiveSubject.next(event.payload)
    );
    this.vrchatProcessActiveSubject.next(await invoke<boolean>('is_vrchat_active'));
  }

  private subscribeToLogEvents(): void {
    this.logService.logEvents.subscribe((event) => {
      switch (event.type) {
        case 'OnPlayerJoined':
          void this.handlePlayerJoined(event);
          break;
        case 'OnPlayerLeft':
          void this.handlePlayerLeft(event);
          break;
        case 'OnLocationChange':
          this.handleLocationChange(event);
          break;
      }
    });
  }

  private async handlePlayerJoined(event: VRChatOnPlayerJoinedEvent): Promise<void> {
    const isCurrentUser = event.userId === (await firstValueFrom(this.auth.user))?.id;
    const currentWorld = this.worldSubject.value;
    const existingPlayer = currentWorld.players.some((player) => player.userId === event.userId);
    const players = existingPlayer
      ? currentWorld.players.map((player) =>
          player.userId === event.userId ? { ...player, displayName: event.displayName } : player
        )
      : [...currentWorld.players, { displayName: event.displayName, userId: event.userId }];
    this.worldSubject.next({
      ...currentWorld,
      players,
      loaded: isCurrentUser ? true : currentWorld.loaded,
      joinedAt: isCurrentUser ? event.timestamp.getTime() : currentWorld.joinedAt,
    });
  }

  private async handlePlayerLeft(event: VRChatOnPlayerLeftEvent): Promise<void> {
    const isCurrentUser = event.userId === (await firstValueFrom(this.auth.user))?.id;
    const currentWorld = this.worldSubject.value;

    this.worldSubject.next({
      ...currentWorld,
      players: currentWorld.players.filter((player) => player.userId !== event.userId),
      loaded: isCurrentUser ? false : currentWorld.loaded,
      joinedAt: isCurrentUser ? undefined : currentWorld.joinedAt,
    });
  }

  private handleLocationChange(event: VRChatOnLocationChangeEvent): void {
    this.worldSubject.next({
      ...this.worldSubject.value,
      instanceId: event.instanceId,
      loaded: false,
      players: [],
      joinedAt: undefined,
    });
  }

  // authentication

  public showLoginModal(autoLogin = false): void {
    this.auth.showLoginModal({ autoLogin });
  }

  public login(username: string, password: string, keepActiveProfile = false): Promise<void> {
    return this.auth.login(username, password, keepActiveProfile);
  }

  public loginNewAccount(username: string, password: string): Promise<void> {
    return this.auth.loginNewAccount(username, password);
  }

  public logout(): Promise<void> {
    return this.auth.logout();
  }

  public activateProfile(profileId: string): Promise<void> {
    return this.auth.activateProfile(profileId);
  }

  public prepareNewLogin(): Promise<void> {
    return this.auth.prepareNewLogin();
  }

  public removeProfile(profileId: string): Promise<void> {
    return this.auth.removeProfile(profileId);
  }

  public verify2FA(code: string, method: VRChatTwoFactorMethod): Promise<void> {
    return this.auth.verify2FA(code, method);
  }

  public rememberCredentials(username: string, password: string): Promise<void> {
    return this.auth.rememberCredentials(username, password);
  }

  public forgetCredentials(): Promise<void> {
    return this.auth.forgetCredentials();
  }

  public loadCredentials(): Promise<{ username: string; password: string } | null> {
    return this.auth.loadCredentials();
  }

  // API operations

  public setStatus(status: UserStatus | null, statusMessage: string | null): Promise<boolean> {
    return this.api.setStatus(status, statusMessage);
  }

  public selectAvatar(avatarId: string): Promise<void> {
    return this.api.selectAvatar(avatarId);
  }

  public async inviteUser(
    inviteeId: string,
    options?: { instanceId?: string; message?: string }
  ): Promise<void> {
    const instanceId = options?.instanceId ?? this.worldSubject.value.instanceId;
    if (!instanceId) {
      error('[VRChat] Tried inviting a user when the current world instance is unknown');
      throw new Error('Cannot invite a user when the current world instance is unknown');
    }
    await this.api.inviteUser(inviteeId, instanceId, options?.message);
  }

  public async declineInviteOrInviteRequest(
    notificationId: string,
    notificationType: 'invite' | 'requestInvite',
    message: string
  ): Promise<void> {
    await this.api.declineInviteOrInviteRequest(notificationId, notificationType, message);
  }

  public listFriends(): Promise<LimitedUserFriend[]> {
    return this.api.listFriends();
  }

  public deleteNotification(notificationId: string): Promise<void> {
    return this.api.deleteNotification(notificationId);
  }

  public listAvatars(force = false): Promise<AvatarEx[]> {
    return this.api.listAvatars(force);
  }

  public representGroup(groupId: string, representing: boolean): Promise<void> {
    return this.api.representGroup(groupId, representing);
  }

  public getUserGroups(force = false): Promise<LimitedUserGroups[]> {
    return this.api.getUserGroups(force);
  }

  public imageUrlForPlayer(player: LimitedUserFriend): string | undefined {
    return player.userIcon || player.profilePicOverride || player.currentAvatarThumbnailImageUrl;
  }

  // settings

  private async loadSettings(): Promise<void> {
    const stored = await SETTINGS_STORE.get<VRChatApiSettings>(SETTINGS_KEY_VRCHAT_API);
    let settings = stored
      ? migrateVRChatApiSettings(stored)
      : structuredClone(VRCHAT_API_SETTINGS_DEFAULT);
    settings = normalizeVRChatProfiles(await this.loadProfileSecrets(settings));
    await this.saveSettings(settings).catch((cause) =>
      error(`[VRChat] Failed to persist loaded settings: ${cause}`)
    );
    this.settingsSubject.next(settings);
  }

  private async loadProfileSecrets(settings: VRChatApiSettings): Promise<VRChatApiSettings> {
    this.failedLegacyProfiles.clear();
    this.failedLegacyCredentialCryptoKey = settings.legacyCredentialCryptoKey;
    this.lockedActiveProfileId = null;
    const needsLegacyKey = settings.profiles.some((profile) => {
      const legacy = profile as VRChatAccountProfile & {
        encryptedPendingTwoFactorLoginIdentifier?: string | null;
      };
      return (
        legacy.encryptedPendingTwoFactorLoginIdentifier != null ||
        typeof profile.rememberedCredentials === 'string'
      );
    });
    let legacyKey: CryptoKey | null = null;
    if (needsLegacyKey) {
      if (settings.legacyCredentialCryptoKey) {
        try {
          legacyKey = await deserializeStorageCryptoKey(settings.legacyCredentialCryptoKey);
        } catch (cause) {
          error(`[VRChat] Failed to unlock legacy credential key: ${cause}`);
        }
      }
    }
    const profiles = await Promise.all(
      settings.profiles.map(async (profile) => {
        let secret: VRChatAccountSecret;
        if (profile.protectedSecret != null) {
          try {
            const json = await unprotectSecret(profile.protectedSecret);
            secret = parseVRChatAccountSecret(JSON.parse(json));
          } catch (cause) {
            error(`[VRChat] Failed to unlock profile ${profile.id}: ${cause}`);
            return normalizeVRChatAccountProfile({
              ...profile,
              ...VRCHAT_ACCOUNT_SECRET_EMPTY,
              secretLocked: true,
            });
          }
        } else {
          try {
            secret = await this.loadLegacyProfileSecret(profile, legacyKey);
          } catch (cause) {
            error(`[VRChat] Failed to migrate credentials for profile ${profile.id}: ${cause}`);
            this.failedLegacyProfiles.set(
              profile.id,
              structuredClone(profile as unknown as Record<string, unknown>)
            );
            return normalizeVRChatAccountProfile({
              ...profile,
              ...VRCHAT_ACCOUNT_SECRET_EMPTY,
              authCookie: profile.authCookie ?? null,
              twoFactorCookie: profile.twoFactorCookie ?? null,
              twoFactorCookieLoginIdentifierHash:
                profile.twoFactorCookieLoginIdentifierHash ?? null,
              secretLocked: false,
            });
          }
        }
        return normalizeVRChatAccountProfile({
          ...profile,
          ...secret,
          protectedSecret: null,
          secretLocked: false,
        });
      })
    );
    const activeProfileId = profiles.some(
      (profile) => profile.id === settings.activeProfileId && !profile.secretLocked
    )
      ? settings.activeProfileId
      : null;
    this.lockedActiveProfileId = profiles.some(
      (profile) => profile.id === settings.activeProfileId && profile.secretLocked
    )
      ? settings.activeProfileId
      : null;
    return { ...settings, profiles, activeProfileId, legacyCredentialCryptoKey: null };
  }

  private async loadLegacyProfileSecret(
    profile: VRChatAccountProfile,
    key: CryptoKey | null
  ): Promise<VRChatAccountSecret> {
    const legacy = profile as VRChatAccountProfile & {
      encryptedPendingTwoFactorLoginIdentifier?: string | null;
    };
    const rawCredentials: unknown = profile.rememberedCredentials;
    if (
      !key &&
      (legacy.encryptedPendingTwoFactorLoginIdentifier != null ||
        typeof rawCredentials === 'string')
    ) {
      throw new Error('Cannot migrate encrypted credentials without their key');
    }
    let pendingTwoFactorLoginIdentifier = profile.pendingTwoFactorLoginIdentifier ?? null;
    let rememberedCredentials =
      rawCredentials &&
      typeof rawCredentials === 'object' &&
      typeof (rawCredentials as Record<string, unknown>)['username'] === 'string' &&
      typeof (rawCredentials as Record<string, unknown>)['password'] === 'string'
        ? (rawCredentials as { username: string; password: string })
        : null;
    if (key && legacy.encryptedPendingTwoFactorLoginIdentifier != null) {
      pendingTwoFactorLoginIdentifier = await decryptStorageData(
        legacy.encryptedPendingTwoFactorLoginIdentifier,
        key
      );
    }
    if (key && typeof rawCredentials === 'string') {
      const encoded = await decryptStorageData(rawCredentials, key);
      const separator = encoded.indexOf(':');
      if (separator < 0) throw new Error('Invalid credential encoding');
      rememberedCredentials = {
        username: atob(encoded.slice(0, separator)),
        password: atob(encoded.slice(separator + 1)),
      };
    }
    return {
      authCookie: profile.authCookie ?? null,
      twoFactorCookie: profile.twoFactorCookie ?? null,
      twoFactorCookieLoginIdentifierHash: profile.twoFactorCookieLoginIdentifierHash ?? null,
      pendingTwoFactorLoginIdentifier,
      rememberCredentials: !!rememberedCredentials && !!profile.rememberCredentials,
      rememberedCredentials,
    };
  }

  private async mutateSettings(
    mutator: (settings: VRChatApiSettings) => VRChatApiSettings
  ): Promise<VRChatApiSettings> {
    let updated = this.settingsSubject.value;
    const mutation = this.settingsUpdate.then(async () => {
      updated = mutator(this.settingsSubject.value);
      await this.saveSettings(updated);
      this.settingsSubject.next(updated);
    });
    this.settingsUpdate = mutation.catch(() => undefined);
    await mutation;
    return updated;
  }

  private async updateProfile(profileId: string, patch: VRChatProfileSessionPatch): Promise<void> {
    await this.mutateSettings((settings) => patchVRChatProfile(settings, profileId, patch));
  }

  private async saveSettings(settings: VRChatApiSettings): Promise<void> {
    const profiles = await Promise.all(
      settings.profiles.map(async (profile) => {
        const failedLegacyProfile = this.failedLegacyProfiles.get(profile.id);
        if (failedLegacyProfile && !profile.userId) return failedLegacyProfile;
        if (failedLegacyProfile) this.failedLegacyProfiles.delete(profile.id);
        return {
          id: profile.id,
          sourceProfileId: profile.sourceProfileId,
          restoreProfileId: profile.restoreProfileId,
          userId: profile.userId,
          username: profile.username,
          displayName: profile.displayName,
          draft: profile.draft,
          protectedSecret: profile.secretLocked
            ? profile.protectedSecret
            : await protectSecret(JSON.stringify(getVRChatAccountSecret(profile))),
        };
      })
    );
    const hasFailedLegacyProfile = settings.profiles.some((profile) =>
      this.failedLegacyProfiles.has(profile.id)
    );
    const lockedActiveProfileId = settings.profiles.some(
      (profile) => profile.id === this.lockedActiveProfileId && profile.secretLocked
    )
      ? this.lockedActiveProfileId
      : null;
    const persisted = {
      version: settings.version,
      profiles,
      activeProfileId: settings.activeProfileId ?? lockedActiveProfileId,
      legacyCredentialCryptoKey: hasFailedLegacyProfile
        ? this.failedLegacyCredentialCryptoKey
        : null,
    } as unknown as VRChatApiSettings;
    await SETTINGS_STORE.set(SETTINGS_KEY_VRCHAT_API, persisted);
    this.lockedActiveProfileId = null;
  }
}
