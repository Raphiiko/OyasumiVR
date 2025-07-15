import { Injectable } from '@angular/core';
import { VRChatService } from './vrchat-api/vrchat.service';
import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
import { Notification, NotificationType, UserStatus } from 'vrchat';
import { info, warn } from '@tauri-apps/plugin-log';
import { firstValueFrom } from 'rxjs';
import { EventLogService } from './event-log.service';
import {
  EventLogAcceptedInviteRequest,
  EventLogDeclinedInvite,
  EventLogDeclinedInviteRequest,
} from '../models/event-log-entry';
import { NotificationService } from './notification.service';
import { TranslateService } from '@ngx-translate/core';
import { AppSettingsService } from './app-settings.service';
import { AutoAcceptInviteRequestsAutomationConfig } from '../models/automations';
import { SleepPreparationService } from './sleep-preparation.service';
import { MessageCenterService } from './message-center/message-center.service';
import { openUrl } from '@tauri-apps/plugin-opener';

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
    private sleepPreparation: SleepPreparationService,
    private messageCenter: MessageCenterService
  ) {}

  async init() {
    this.vrchat.notifications.subscribe(async (notification) => {
      switch (notification.type) {
        case NotificationType.RequestInvite:
          await this.handleRequestInviteNotification(notification);
          break;
        case NotificationType.Invite:
          await this.handleInviteNotification(notification);
          break;
      }
    });
    this.handlePlayerListPresetAutomations();
  }

  private async handleInviteNotification(notification: Notification) {
    info(`[VRChat] Received invite from ${notification.senderUsername}`);
    // Get the current user
    const user = await firstValueFrom(this.vrchat.user);
    if (!user) return;
    // Get the automation config
    const config = await firstValueFrom(this.automationConfig.configs).then(
      (c) => c.AUTO_ACCEPT_INVITE_REQUESTS
    );
    // Decline invites if configured
    const message = await this.getInviteDeclineMessage(config);
    if (message) {
      await this.vrchat.declineInviteOrInviteRequest(notification.id, 'invite', message);
      await this.vrchat.deleteNotification(notification.id);
      this.eventLog.logEvent({
        type: 'declinedInvite',
        displayName: notification.senderUsername,
        reason: 'SLEEP_MODE_ENABLED',
      } as EventLogDeclinedInvite);
    }
    // Play a sound if configured
    if (config.playSoundOnInvite) {
      if (config.playSoundOnInvite_onlyWhenAsleep && !(await firstValueFrom(this.sleep.mode)))
        return;
      await this.notifications.playSoundConfig(config.playSoundOnInvite);
    }
  }

  private async playInviteRequestSound(
    config: AutoAcceptInviteRequestsAutomationConfig,
    handled: boolean,
    sleepMode: boolean
  ) {
    if (!config.playSoundOnInviteRequest) return;
    if (handled && config.playSoundOnInviteRequest_onlyWhenUnhandled) return;
    if (!sleepMode && config.playSoundOnInviteRequest_onlyWhenAsleep) return;
    await this.notifications.playSoundConfig(config.playSoundOnInviteRequest);
  }

  private async handleRequestInviteNotification(notification: Notification) {
    info(`[VRChat] Received invite request from ${notification.senderUsername}`);
    // Get the current user
    const user = await firstValueFrom(this.vrchat.user);
    if (!user) return;
    // Get the sleep mode
    const sleepMode = await firstValueFrom(this.sleep.mode);
    // Get the automation config
    const config = await firstValueFrom(this.automationConfig.configs).then(
      (c) => c.AUTO_ACCEPT_INVITE_REQUESTS
    );
    // Stop if VRChat is not currently running
    if (!(await firstValueFrom(this.vrchat.vrchatProcessActive))) {
      warn(
        `[VRChat] Ignoring invite request from ${notification.senderUsername}, as VRChat is not currently running.`
      );
      this.playInviteRequestSound(config, false, sleepMode);
      return;
    }
    // Stop if the automation is disabled
    if (!config.enabled) {
      warn(
        '[VRChat] Ignoring invite request because the auto-accept invite requests automation is disabled'
      );
      this.playInviteRequestSound(config, false, sleepMode);
      return;
    }
    // Stop here if the user's current world is not known
    const world = await firstValueFrom(this.vrchat.world);
    if (!world?.instanceId) {
      warn(
        `[VRChat] Ignoring invite request from ${notification.senderUsername}, as the user's current world is not currently known.`
      );
      this.playInviteRequestSound(config, false, sleepMode);
      this.messageCenter.addMessage({
        id: `vrcInviteRequestFailedWorldUnknown_${notification.senderUsername}`,
        title: 'message-center.messages.vrcInviteRequestFailedWorldUnknown.title',
        message: {
          string: 'message-center.messages.vrcInviteRequestFailedWorldUnknown.message',
          values: {
            senderUsername:
              notification.senderUsername ??
              this.translate.instant(
                'message-center.messages.vrcInviteRequestFailedWorldUnknown.unknownFriend'
              ),
          },
        },
        closeable: true,
        actions: [
          {
            label: 'message-center.actions.moreInfo',
            action: () => {
              openUrl(
                'https://raphii.co/oyasumivr/hidden/troubleshooting/vrchat-invite-request-auto-accept-world-unknown/'
              );
            },
          },
        ],
        type: 'warning',
      });
      return;
    }
    // Automatically accept invite requests when on blue, in case the VRChat client does not.
    if (user.status === UserStatus.JoinMe) {
      info(
        `[VRChat] Automatically accepting invite request from ${notification.senderUserId} (blue status)`
      );
      await this.vrchat.deleteNotification(notification.id);
      await this.vrchat.inviteUser(notification.senderUserId);
      this.playInviteRequestSound(config, true, sleepMode);
      return;
    }
    // Stop if sleep mode is disabled and it's required to be enabled
    if (config.onlyIfSleepModeEnabled && !sleepMode) {
      warn('[VRChat] Ignoring invite request because sleep mode is disabled');
      const message = await this.getInviteRequestDeclineMessage(config);
      if (message) {
        await this.vrchat.declineInviteOrInviteRequest(notification.id, 'requestInvite', message);
        await this.vrchat.deleteNotification(notification.id);
        this.eventLog.logEvent({
          type: 'declinedInviteRequest',
          displayName: notification.senderUsername,
          reason: 'SLEEP_MODE_ENABLED_CONDITION_FAILED',
        } as EventLogDeclinedInviteRequest);
      }
      this.playInviteRequestSound(config, !!message, sleepMode);
      return;
    }
    // Stop if there is a player count limit set, and there are more people in the instance than the limit
    if (config.onlyBelowPlayerCountEnabled) {
      const world = await firstValueFrom(this.vrchat.world);
      if (world.players.length >= config.onlyBelowPlayerCount) {
        warn(
          `[VRChat] Ignoring invite request because there are too many players in the instance (${world.players.length}>=${config.onlyBelowPlayerCount})`
        );
        const message = await this.getInviteRequestDeclineMessage(config);
        if (message) {
          await this.vrchat.declineInviteOrInviteRequest(notification.id, 'requestInvite', message);
          await this.vrchat.deleteNotification(notification.id);
          this.eventLog.logEvent({
            type: 'declinedInviteRequest',
            displayName: notification.senderUsername,
            reason: 'PLAYER_COUNT_CONDITION_FAILED',
          } as EventLogDeclinedInviteRequest);
        }
        this.playInviteRequestSound(config, !!message, sleepMode);
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
          warn('[VRChat] Ignoring invite request because player is not on whitelist');
          const message = await this.getInviteRequestDeclineMessage(config);
          if (message) {
            await this.vrchat.declineInviteOrInviteRequest(
              notification.id,
              'requestInvite',
              message
            );
            await this.vrchat.deleteNotification(notification.id);
            this.eventLog.logEvent({
              type: 'declinedInviteRequest',
              displayName: notification.senderUsername,
              reason: 'NOT_ON_WHITELIST',
            } as EventLogDeclinedInviteRequest);
          }
          this.playInviteRequestSound(config, !!message, sleepMode);
          return;
        }
        break;
      case 'BLACKLIST':
        // Stop if the player is on the blacklist
        if (config.playerIds.includes(notification.senderUserId)) {
          warn('[VRChat] Ignoring invite request because player is on blacklist');
          const message = await this.getInviteRequestDeclineMessage(config);
          if (message) {
            await this.vrchat.declineInviteOrInviteRequest(
              notification.id,
              'requestInvite',
              message
            );
            await this.vrchat.deleteNotification(notification.id);
            this.eventLog.logEvent({
              type: 'declinedInviteRequest',
              displayName: notification.senderUsername,
              reason: 'ON_BLACKLIST',
            } as EventLogDeclinedInviteRequest);
          }
          this.playInviteRequestSound(config, !!message, sleepMode);
          return;
        }
        break;
    }
    // Invite the player
    info(`[VRChat] Automatically accepting invite request from ${notification.senderUserId}`);
    await this.vrchat.deleteNotification(notification.id);
    await this.vrchat.inviteUser(notification.senderUserId, {
      message: this.getInviteRequestAcceptMessage(config),
    });
    this.playInviteRequestSound(config, true, sleepMode);
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

  private getInviteRequestAcceptMessage(
    config: AutoAcceptInviteRequestsAutomationConfig
  ): string | undefined {
    if (!config.acceptMessageEnabled) return undefined;
    let message = config.acceptInviteRequestMessage;
    message = message.replace(/\s+/g, ' ').trim();
    if (message.length === 0) {
      message = this.translate.instant(
        'invite-and-invite-requests.inviteRequestsTab.options.acceptMessage.customMessage.placeholder'
      );
      message = message.replace(/\s+/g, ' ').trim();
    }
    return message;
  }

  private async getInviteRequestDeclineMessage(
    config: AutoAcceptInviteRequestsAutomationConfig
  ): Promise<string | undefined> {
    if (config.declineOnRequest === 'DISABLED') return undefined;
    if (config.declineOnRequest === 'WHEN_SLEEPING' && !(await firstValueFrom(this.sleep.mode)))
      return undefined;
    let message = config.declineInviteRequestMessage;
    message = message.replace(/\s+/g, ' ').trim();
    if (message.length === 0) {
      message = this.translate.instant(
        'invite-and-invite-requests.inviteRequestsTab.options.declineOnRequest.customMessage.placeholder'
      );
      message = message.replace(/\s+/g, ' ').trim();
    }
    return message;
  }

  private async getInviteDeclineMessage(
    config: AutoAcceptInviteRequestsAutomationConfig
  ): Promise<string | undefined> {
    if (!config.declineInvitesWhileAsleep || !(await firstValueFrom(this.sleep.mode)))
      return undefined;
    let message = config.declineInviteMessage;
    message = message.replace(/\s+/g, ' ').trim();
    if (message.length === 0) {
      message = this.translate.instant(
        'invite-and-invite-requests.invitesTab.options.declineOnInviteWhileAsleep.customMessage.placeholder'
      );
      message = message.replace(/\s+/g, ' ').trim();
    }
    return message;
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
