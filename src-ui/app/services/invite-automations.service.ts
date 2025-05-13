import { Injectable } from '@angular/core';
import { VRChatService } from './vrchat-api/vrchat.service';
import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
import { Notification, NotificationType, UserStatus } from 'vrchat';
import { info, warn } from '@tauri-apps/plugin-log';
import { firstValueFrom } from 'rxjs';
import { EventLogService } from './event-log.service';
import { EventLogAcceptedInviteRequest } from '../models/event-log-entry';
import { NotificationService } from './notification.service';
import { TranslateService } from '@ngx-translate/core';
import { AppSettingsService } from './app-settings.service';
import { AutoAcceptInviteRequestsAutomationConfig } from '../models/automations';
import { SleepPreparationService } from './sleep-preparation.service';

@Injectable({
  providedIn: 'root',
})
export class InviteAutomationsService {
  constructor(
    private vrchat: VRChatService,
    private automationConfig: AutomationConfigService,
    private appSettings: AppSettingsService,
    private sleep: SleepService,
    private eventLog: EventLogService,
    private notifications: NotificationService,
    private translate: TranslateService,
    private sleepPreparation: SleepPreparationService
  ) {}

  async init() {
    this.vrchat.notifications.subscribe(async (notification) => {
      switch (notification.type) {
        case NotificationType.RequestInvite:
          await this.handleRequestInviteNotification(notification);
          break;
      }
    });
    this.handlePlayerListPresetAutomations();
  }

  private async handleRequestInviteNotification(notification: Notification) {
    // Get the current user
    const user = await firstValueFrom(this.vrchat.user);
    if (!user) return;
    // Automatically accept invite requests when on blue, in case the VRChat client does not.
    if (user.status === UserStatus.JoinMe) {
      info(
        `[VRChat] Automatically accepting invite request from ${notification.senderUserId} (blue status)`
      );
      await this.vrchat.deleteNotification(notification.id);
      await this.vrchat.inviteUser(notification.senderUserId);
      return;
    }
    // Get the automation config
    const config = await firstValueFrom(this.automationConfig.configs).then(
      (c) => c.AUTO_ACCEPT_INVITE_REQUESTS
    );
    // Stop if the automation is disabled
    if (!config.enabled) {
      warn('Ignoring invite because automation is disabled');
      return;
    }
    // Stop if sleep mode is disabled and it's required to be enabled
    if (config.onlyIfSleepModeEnabled && !(await firstValueFrom(this.sleep.mode))) {
      warn('Ignoring invite because sleep mode is disabled');
      return;
    }
    // Stop if there is a player count limit set, and there are more people in the instance than the limit
    if (config.onlyBelowPlayerCountEnabled) {
      const world = await firstValueFrom(this.vrchat.world);
      if (world.playerCount >= config.onlyBelowPlayerCount) {
        warn(
          `Ignoring invite because there are too many players in the instance (${world.playerCount}>=${config.onlyBelowPlayerCount})`
        );
        return;
      }
    }
    switch (config.listMode) {
      case 'DISABLED':
        // No check needed
        break;
      case 'WHITELIST':
        // Stop if the player is not on the whitelist
        if (!config.playerIds.includes(notification.senderUserId)) {
          warn('Ignoring invite because player is not on whitelist');
          return;
        }
        break;
      case 'BLACKLIST':
        // Stop if the player is on the blacklist
        if (config.playerIds.includes(notification.senderUserId)) {
          warn('Ignoring invite because player is on blacklist');
          return;
        }
        break;
    }
    // Invite the player
    info(`[VRChat] Automatically accepting invite request from ${notification.senderUserId}`);
    await this.vrchat.deleteNotification(notification.id);
    await this.vrchat.inviteUser(notification.senderUserId);
    if (await this.notifications.notificationTypeEnabled('AUTO_ACCEPTED_INVITE_REQUEST')) {
      await this.notifications.send(
        this.translate.instant('notifications.autoAcceptedInviteRequest.content', {
          username: notification.senderUsername,
        })
      );
    }
    this.eventLog.logEvent({
      type: 'acceptedInviteRequest',
      displayName: notification.senderUsername,
      mode: config.listMode,
    } as EventLogAcceptedInviteRequest);
  }

  private handlePlayerListPresetAutomations() {
    this.sleepPreparation.onSleepPreparation.subscribe(async () => {
      const config = await firstValueFrom(this.automationConfig.configs);
      if (!config.AUTO_ACCEPT_INVITE_REQUESTS.presetOnSleepPreparation) return;
      const appSettings = await firstValueFrom(this.appSettings.settings);
      const preset = appSettings.playerListPresets.find(
        (p) => p.id === config.AUTO_ACCEPT_INVITE_REQUESTS.presetOnSleepPreparation
      );
      if (preset) {
        await this.automationConfig.updateAutomationConfig<AutoAcceptInviteRequestsAutomationConfig>(
          'AUTO_ACCEPT_INVITE_REQUESTS',
          {
            playerIds: preset.playerIds,
          }
        );
      }
    });

    this.sleep.mode.subscribe(async (sleepMode) => {
      const config = await firstValueFrom(this.automationConfig.configs);
      const appSettings = await firstValueFrom(this.appSettings.settings);
      if (sleepMode && config.AUTO_ACCEPT_INVITE_REQUESTS.presetOnSleepEnable) {
        const preset = appSettings.playerListPresets.find(
          (p) => p.id === config.AUTO_ACCEPT_INVITE_REQUESTS.presetOnSleepEnable
        );
        if (preset) {
          await this.automationConfig.updateAutomationConfig<AutoAcceptInviteRequestsAutomationConfig>(
            'AUTO_ACCEPT_INVITE_REQUESTS',
            {
              playerIds: preset.playerIds,
            }
          );
        }
      } else if (!sleepMode && config.AUTO_ACCEPT_INVITE_REQUESTS.presetOnSleepDisable) {
        const preset = appSettings.playerListPresets.find(
          (p) => p.id === config.AUTO_ACCEPT_INVITE_REQUESTS.presetOnSleepDisable
        );
        if (preset) {
          await this.automationConfig.updateAutomationConfig<AutoAcceptInviteRequestsAutomationConfig>(
            'AUTO_ACCEPT_INVITE_REQUESTS',
            {
              playerIds: preset.playerIds,
            }
          );
        }
      }
    });
  }
}
