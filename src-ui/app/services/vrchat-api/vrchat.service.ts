import { Injectable } from '@angular/core';
import type { CurrentUser, LimitedUser, Notification, UserStatus } from 'vrchat/dist';
import { SETTINGS_KEY_VRCHAT_API, SETTINGS_STORE } from '../../globals';
import { VRCHAT_API_SETTINGS_DEFAULT, VRChatApiSettings } from '../../models/vrchat-api-settings';
import { migrateVRChatApiSettings } from '../../migrations/vrchat-api-settings.migrations';
import { BehaviorSubject, combineLatest, filter, firstValueFrom, map, Observable } from 'rxjs';
import { ModalService } from 'src-ui/app/services/modal.service';
import { AvatarEx, WorldContext } from '../../models/vrchat';
import { VRChatLogService } from '../vrchat-log.service';
import { generateStorageCryptoKey, serializeStorageCryptoKey } from '../../utils/crypto';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { VRChatAPI } from './vrchat-api';
import { VRChatAuth, VRChatAuthStatus } from './vrchat-auth';
import { VRChatSocket } from './vrchat-socket';
import { error } from '@tauri-apps/plugin-log';

@Injectable({
  providedIn: 'root',
})
export class VRChatService {
  private _settings = new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT);
  private _vrchatProcessActive = new BehaviorSubject(false);
  private _world: BehaviorSubject<WorldContext> = new BehaviorSubject<WorldContext>({
    playerCount: 1,
    loaded: false,
  });

  private api: VRChatAPI;
  private auth: VRChatAuth;
  private socket: VRChatSocket;

  public settings = this._settings.asObservable();
  public user: Observable<CurrentUser | null>;
  public status: Observable<VRChatAuthStatus>;
  public notifications: Observable<Notification>;
  public isFetchingFriends: Observable<boolean>;
  public vrchatProcessActive = this._vrchatProcessActive.asObservable();
  public world: Observable<WorldContext> = combineLatest([
    this._world,
    this.logService.initialLoadComplete.pipe(filter((complete) => complete)),
  ]).pipe(map(([world]) => world));

  constructor(modalService: ModalService, private logService: VRChatLogService) {
    this.api = new VRChatAPI(this.settings, this.updateSettings.bind(this));
    this.auth = new VRChatAuth(
      this.api,
      modalService,
      this.updateSettings.bind(this),
      this.settings
    );
    this.socket = new VRChatSocket(this.auth, this.settings);
    // Expose public state
    this.user = this.auth.user;
    this.status = this.auth.status;
    this.notifications = this.socket.notifications;
    this.isFetchingFriends = this.api.isFetchingFriends;
  }

  async init() {
    await this.loadSettings();
    await this.api.init(this.auth.user, this.auth.patchCurrentUser.bind(this.auth));
    await this.auth.init();
    await this.socket.init();
    await this.subscribeToLogEvents();
    await this.watchVRChatProcess();
  }

  private async watchVRChatProcess() {
    await listen<boolean>('VRCHAT_PROCESS_ACTIVE', (event) =>
      this._vrchatProcessActive.next(event.payload)
    );
    this._vrchatProcessActive.next(await invoke<boolean>('is_vrchat_active'));
  }

  private async subscribeToLogEvents() {
    this.logService.logEvents.subscribe(async (event) => {
      switch (event.type) {
        case 'OnPlayerJoined': {
          const context = {
            ...structuredClone(this._world.value),
            playerCount: this._world.value.playerCount + 1,
          };
          if (event.userId === (await firstValueFrom(this.auth.user))?.id) context.loaded = true;
          this._world.next(context);
          break;
        }
        case 'OnPlayerLeft': {
          const context = {
            ...structuredClone(this._world.value),
            playerCount: Math.max(this._world.value.playerCount - 1, 0),
          };
          if (event.userId === (await firstValueFrom(this.auth.user))?.id) context.loaded = false;
          this._world.next(context);
          break;
        }
        case 'OnLocationChange':
          this._world.next({
            ...structuredClone(this._world.value),
            playerCount: 0,
            instanceId: event.instanceId,
            loaded: false,
          });
          break;
      }
    });
  }

  //
  // Authentication methods
  //

  public showLoginModal(autoLogin = false) {
    this.auth.showLoginModal(autoLogin);
  }

  public async login(username: string, password: string) {
    await this.auth.login(username, password);
  }

  public async logout() {
    await this.auth.logout();
  }

  public async verify2FA(code: string, method: 'totp' | 'otp' | 'emailotp') {
    await this.auth.verify2FA(code, method);
  }

  public async rememberCredentials(username: string, password: string) {
    await this.auth.rememberCredentials(username, password);
  }

  public async forgetCredentials() {
    await this.auth.forgetCredentials();
  }

  public async loadCredentials(): Promise<{ username: string; password: string } | null> {
    return await this.auth.loadCredentials();
  }

  //
  // API methods
  //

  public async setStatus(status: UserStatus | null, statusMessage: string | null) {
    await this.api.setStatus(status, statusMessage);
  }

  public async selectAvatar(avatarId: string) {
    await this.api.selectAvatar(avatarId);
  }

  public async inviteUser(inviteeId: string, instanceId?: string) {
    // Throw if instance id was not provided and we don't know the current world id.
    if (!instanceId) instanceId = this._world.value?.instanceId;
    if (!instanceId) {
      error('[VRChat] Tried inviting a user when the current world instance is unknown');
      throw new Error('Cannot invite a user when the current world instance is unknown');
    }
    await this.api.inviteUser(inviteeId, instanceId);
  }

  public async listFriends(): Promise<LimitedUser[]> {
    return await this.api.listFriends();
  }

  public async deleteNotification(notificationId: string) {
    await this.api.deleteNotification(notificationId);
  }

  public async listAvatars(force = false): Promise<AvatarEx[]> {
    return await this.api.listAvatars(force);
  }

  //
  // Utility methods
  //

  public imageUrlForPlayer(player: LimitedUser) {
    return player.userIcon || player.profilePicOverride || player.currentAvatarThumbnailImageUrl;
  }

  //
  // Settings management
  //

  private async loadSettings() {
    let settings: VRChatApiSettings | undefined = await SETTINGS_STORE.get<VRChatApiSettings>(
      SETTINGS_KEY_VRCHAT_API
    );
    settings = settings ? migrateVRChatApiSettings(settings) : this._settings.value;
    this.auth.handleSettingsLoad(settings);
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
    const newSettings = Object.assign(structuredClone(this._settings.value), settings);
    this._settings.next(newSettings);
    await this.saveSettings();
  }

  private async saveSettings() {
    await SETTINGS_STORE.set(SETTINGS_KEY_VRCHAT_API, this._settings.value);
    await SETTINGS_STORE.save();
  }
}
