import { Injectable } from '@angular/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  JoinNotificationsAutomationsConfig,
  JoinNotificationsMode,
} from '../models/automations';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
import { VRChatService } from './vrchat.service';
import { NotificationService } from './notification.service';
import { concatMap, filter, firstValueFrom, Subject, switchMap, tap } from 'rxjs';
import { VRChatLogService } from './vrchat-log.service';
import { VRChatLogEvent } from '../models/vrchat-log-event';
import { LimitedUser } from 'vrchat/dist';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class JoinNotificationsService {
  private config: JoinNotificationsAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.JOIN_NOTIFICATIONS
  );
  private ownVRChatDisplayName = '';
  private alone = false;
  private notAloneSince = 0;
  private friends: LimitedUser[] = [];
  private playNotification = new Subject<{
    notification?: {
      displayName: string;
      type: 'join' | 'leave';
    };
    sound?: boolean;
  }>();
  private worldLoaded = false;

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleep: SleepService,
    private vrchat: VRChatService,
    private notification: NotificationService,
    private vrchatLog: VRChatLogService,
    private translate: TranslateService
  ) {}

  public async init() {
    // Keep config up to date
    this.automationConfigService.configs.subscribe((configs) => {
      this.config = configs.JOIN_NOTIFICATIONS;
    });
    this.vrchat.user
      .pipe(
        // Keep track of own display name
        tap((user) => {
          this.ownVRChatDisplayName = user?.displayName ?? '';
        }),
        // Stop if not logged in
        filter(Boolean),
        // Keep track of friends
        switchMap(async () => {
          this.friends = await this.vrchat.listFriends();
          // TODO: HANDLE FRIEND LIST CHANGES (ADD/REMOVE/DISPLAY NAME CHANGE)
        })
      )
      .subscribe();
    // Process log events
    this.vrchatLog.logEvents.subscribe((event) => {
      this.onLogEvent(event);
    });
    // Track alone status
    this.vrchat.world.subscribe((w) => {
      const alone = w.playerCount <= 1;
      const wasAlone = this.alone;
      if (wasAlone && !alone) this.notAloneSince = Date.now();
      this.alone = alone;
      this.worldLoaded = w.loaded;
    });
    // Process notifications and sounds
    this.playNotification
      .pipe(
        concatMap(async (val) => {
          if (val.notification) {
            const message = this.translate.instant(
              `join-notifications.notification.${val.notification.type}`,
              { name: val.notification.displayName }
            );
            await this.notification.send(message, 3000);
          }
          if (val.sound) {
            await this.notification.playSound(
              'notification_reverie',
              this.config.joinSoundVolume / 100
            );
          }
          // Max 1 notification/sound per 3 seconds
          await new Promise((resolve) => setTimeout(resolve, 3000));
        })
      )
      .subscribe();
  }

  private async onLogEvent(event: VRChatLogEvent) {
    // Don't process events from initial load, or from before a world has loaded
    if (event.initialLoad || !this.worldLoaded) return;
    // Don't process these events while VRC is not active
    const vrcActive = await firstValueFrom(this.vrchat.vrchatProcessActive);
    if (!vrcActive) return;

    switch (event.type) {
      case 'OnPlayerJoined':
        this.onPlayerJoined(event.displayName);
        break;
      case 'OnPlayerLeft':
        this.onPlayerLeft(event.displayName);
        break;
    }
  }

  private async onPlayerJoined(displayName: string) {
    // Don't process own join
    if (this.ownVRChatDisplayName === displayName) return;

    // Sleep Check
    const sleepMode = await firstValueFrom(this.sleep.mode);
    if (this.config.onlyDuringSleepMode && !sleepMode) return;

    // Mode check
    const notification = this.appliesForPlayer(this.config.joinNotification, displayName);
    const sound = this.appliesForPlayer(this.config.joinSound, displayName);

    // Stop here if no notification or sound
    if (!notification && !sound) return;

    // World player count check
    if (this.config.onlyWhenPreviouslyAlone) {
      // Wait for 1 second to make sure the world context has updated
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // Stop here if we've not been alone in the past 10 seconds
      if (Date.now() - this.notAloneSince > 10000) return;
    }

    // Queue the notification and/or sound
    if (notification || sound) {
      this.playNotification.next({
        notification: notification ? { displayName, type: 'join' } : undefined,
        sound,
      });
    }
  }

  private async onPlayerLeft(displayName: string) {
    // Don't process own leave
    if (this.ownVRChatDisplayName === displayName) return;

    // Sleep Check
    const sleepMode = await firstValueFrom(this.sleep.mode);
    if (this.config.onlyDuringSleepMode && !sleepMode) return;

    // Mode check
    const notification = this.appliesForPlayer(this.config.leaveNotification, displayName);
    const sound = this.appliesForPlayer(this.config.leaveSound, displayName);

    // Stop here if no notification or sound
    if (!notification && !sound) return;

    // World player count check
    if (this.config.onlyWhenLeftAlone) {
      // Wait for 1 second to make sure the world context has updated
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // If we're not alone, stop here
      if (!this.alone) return;
    }

    // Queue the notification and/or sound
    if (notification || sound) {
      this.playNotification.next({
        notification: notification ? { displayName, type: 'leave' } : undefined,
        sound,
      });
    }
  }

  private appliesForPlayer(mode: JoinNotificationsMode, displayName: string): boolean {
    switch (mode) {
      case 'EVERYONE':
        return true;
      case 'WHITELIST':
        return this.isPlayerOnList(displayName);
      case 'BLACKLIST':
        return !this.isPlayerOnList(displayName);
      case 'DISABLED':
        return false;
    }
  }

  private isPlayerOnList(displayName: string): boolean {
    const playerIds = this.config.playerIds;
    const playerId = this.getFriendIdForDisplayName(displayName);
    if (!playerId || !playerIds.includes(playerId)) return false;
    return false;
  }

  private getFriendIdForDisplayName(displayName: string): string | null {
    const friend = this.friends.find((f) => f.displayName === displayName);
    return friend?.id ?? null;
  }
}
