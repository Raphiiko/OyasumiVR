import { Injectable } from '@angular/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  JoinNotificationsAutomationsConfig,
  JoinNotificationsMode,
} from '../models/automations';

import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
import { VRChatService } from './vrchat.service';
import { NotificationService } from './notification.service';
import {
  concatMap,
  delay,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  skip,
  Subject,
  switchMap,
  tap,
} from 'rxjs';
import { VRChatLogService } from './vrchat-log.service';
import { VRChatLogEvent } from '../models/vrchat-log-event';
import { LimitedUser } from 'vrchat/dist';
import { TranslateService } from '@ngx-translate/core';
import { v4 as uuid } from 'uuid';

@Injectable({
  providedIn: 'root',
})
export class JoinNotificationsService {
  private config: JoinNotificationsAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.JOIN_NOTIFICATIONS
  );
  private ownVRChatDisplayName = '';
  private alone = false;
  private notAloneSince = 0;
  private friends: LimitedUser[] = [];
  private worldLoaded = false;
  private playNotification = new Subject<{
    id?: string;
    notification?: {
      displayName: string;
      type: 'join' | 'leave';
    };
    sound?: boolean;
  }>();
  queuedNotifications: string[] = [];

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
    // Clear queued notifications when VRChat stops
    this.vrchat.vrchatProcessActive
      .pipe(
        skip(1),
        distinctUntilChanged(),
        filter((active) => !active)
      )
      .subscribe(() => {
        this.queuedNotifications = [];
      });
    // Clear queued notifications when switching worlds
    this.vrchat.world
      .pipe(
        skip(1),
        distinctUntilChanged((a, b) => a.instanceId === b.instanceId && a.loaded === b.loaded)
      )
      .subscribe(() => {
        this.queuedNotifications = [];
      });
    // Process notifications and sounds
    this.playNotification
      .pipe(
        tap((val) => {
          const notificationId = uuid();
          val.id = notificationId;
          this.queuedNotifications.push(notificationId);
          return val;
        }),
        delay(500), // Allows queued notifications to be cancelled before they fire in case of a world change
        concatMap(async (val) => {
          // Skip if it's ID is not queued
          if (!this.queuedNotifications.includes(val.id ?? '')) return;
          // Remove ID from queued notifications
          this.queuedNotifications = this.queuedNotifications.filter((id) => id !== val.id);
          // Send notification
          if (val.notification) {
            const message = this.translate.instant(
              `join-notifications.notification.${val.notification.type}`,
              { name: val.notification.displayName }
            );
            await this.notification.send(message, 5000);
          }
          // Send sound
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
      case 'FRIEND':
        return this.friends.some((f) => f.displayName === displayName);
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
    return true;
  }

  private getFriendIdForDisplayName(displayName: string): string | null {
    const friend = this.friends.find((f) => f.displayName === displayName);
    return friend?.id ?? null;
  }
}
