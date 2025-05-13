import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  JoinNotificationsMode,
  SleepModeDisableOnPlayerJoinOrLeaveAutomationConfig,
} from '../../models/automations';

import { SleepService } from '../sleep.service';
import { filter, firstValueFrom, map, switchMap, tap } from 'rxjs';
import { LimitedUser } from 'vrchat';
import { VRChatLogService } from '../vrchat-log.service';
import { VRChatLogEvent } from '../../models/vrchat-log-event';
import { VRChatService } from '../vrchat-api/vrchat.service';

@Injectable({
  providedIn: 'root',
})
export class SleepModeDisableOnPlayerJoinLeaveAutomationService {
  private config: SleepModeDisableOnPlayerJoinOrLeaveAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE
  );
  private ownVRChatDisplayName = '';
  private alone = false;
  private notAloneSince = 0;
  private friends: LimitedUser[] = [];
  private worldLoaded = false;
  private sleepMode = false;

  constructor(
    private automationConfig: AutomationConfigService,
    private sleep: SleepService,
    private vrchat: VRChatService,
    private vrchatLog: VRChatLogService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE))
      .subscribe((config) => (this.config = config));
    this.sleep.mode.subscribe((mode) => (this.sleepMode = mode));
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
  }

  private async onLogEvent(event: VRChatLogEvent) {
    // Don't process events while the sleep mode is inactive,
    // events from initial load, or events from before a world has loaded
    if (!this.config.enabled || !this.sleepMode || event.initialLoad || !this.worldLoaded) return;
    // Only process join and leave events
    if (event.type !== 'OnPlayerJoined' && event.type !== 'OnPlayerLeft') return;
    // Don't process these events while VRC is not active
    const vrcActive = await firstValueFrom(this.vrchat.vrchatProcessActive);
    if (!vrcActive) return;
    // Don't process events from the user themselves
    if (event.displayName === this.ownVRChatDisplayName) return;
    // Check per event
    if (event.type === 'OnPlayerJoined') {
      // Stop here if the user who joined does not apply
      if (!this.appliesForPlayer(this.config.joinMode, event.displayName)) return;
      // World player count check
      if (this.config.onlyWhenPreviouslyAlone) {
        // Wait for 1 second to make sure the world context has updated
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Stop here if we've not been alone in the past 10 seconds
        if (Date.now() - this.notAloneSince > 10000) return;
      }
      // Disable sleep mode
      await this.sleep.disableSleepMode({
        type: 'AUTOMATION',
        automation: 'SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE',
        event: 'join',
        displayName: event.displayName,
      });
    } else if (event.type === 'OnPlayerLeft') {
      // Stop here if the user who left does not apply
      if (!this.appliesForPlayer(this.config.leaveMode, event.displayName)) return;
      // World player count check
      if (this.config.onlyWhenLeftAlone) {
        // Wait for 1 second to make sure the world context has updated
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // If we're not alone, stop here
        if (!this.alone) return;
      }
      // Disable sleep mode
      await this.sleep.disableSleepMode({
        type: 'AUTOMATION',
        automation: 'SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE',
        event: 'leave',
        displayName: event.displayName,
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
