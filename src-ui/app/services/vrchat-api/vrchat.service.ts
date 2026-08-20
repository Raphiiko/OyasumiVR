import { inject, Injectable } from '@angular/core';
import type { CurrentUser, LimitedUserFriend, Notification, LimitedUserGroups } from 'vrchat';
import { SETTINGS_KEY_VRCHAT_API, SETTINGS_STORE } from '../../globals';
import { VRCHAT_API_SETTINGS_DEFAULT, VRChatApiSettings } from '../../models/vrchat-api-settings';
import { migrateVRChatApiSettings } from '../../migrations/vrchat-api-settings.migrations';
import { BehaviorSubject, combineLatest, filter, firstValueFrom, map, Observable } from 'rxjs';
import { ModalService } from 'src-ui/app/services/modal.service';
import { AvatarEx, UserStatus, WorldContext } from '../../models/vrchat';
import { VRChatLogService } from '../vrchat-log.service';
import { generateStorageCryptoKey, serializeStorageCryptoKey } from '../../utils/crypto';
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

@Injectable({
  providedIn: 'root',
})
export class VRChatService {
  private readonly modalService = inject(ModalService);
  private readonly logService = inject(VRChatLogService);

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

  public readonly settings = this.settingsSubject.asObservable();
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
    this.api = new VRChatAPI(this.settings, this.updateSettings.bind(this));
    this.auth = new VRChatAuth(
      this.api,
      this.modalService,
      this.updateSettings.bind(this),
      this.settings
    );
    this.socket = new VRChatSocket(this.auth, this.api, this.settings);
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
    this.auth.showLoginModal(autoLogin);
  }

  public login(username: string, password: string): Promise<void> {
    return this.auth.login(username, password);
  }

  public logout(): Promise<void> {
    return this.auth.logout();
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
    let settings: VRChatApiSettings | undefined =
      await SETTINGS_STORE.get<VRChatApiSettings>(SETTINGS_KEY_VRCHAT_API);
    settings = settings ? migrateVRChatApiSettings(settings) : { ...this.settingsSubject.value };
    if (!settings.credentialCryptoKey) {
      const key = await generateStorageCryptoKey();
      settings.credentialCryptoKey = await serializeStorageCryptoKey(key);
    }
    this.settingsSubject.next(settings);
    await this.saveSettings();
  }

  private async updateSettings(settings: Partial<VRChatApiSettings>): Promise<void> {
    this.settingsSubject.next({ ...this.settingsSubject.value, ...settings });
    await this.saveSettings();
  }

  private async saveSettings(): Promise<void> {
    await SETTINGS_STORE.set(SETTINGS_KEY_VRCHAT_API, this.settingsSubject.value);
  }
}
