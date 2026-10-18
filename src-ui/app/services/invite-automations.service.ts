import { Injectable } from '@angular/core';
import { VRChatService } from './vrchat-api/vrchat.service';
import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
import type { Notification } from 'vrchat';
import { NotificationType, UserStatus } from '../models/vrchat';
import { error, info, warn } from '@tauri-apps/plugin-log';
import { firstValueFrom } from 'rxjs';
import { EventLogService } from './event-log.service';
import {
  EventLogAcceptedInviteRequest,
  EventLogDeclinedInvite,
  EventLogDeclinedInviteRequest,
  EventLogFailedInviteRequest,
} from '../models/event-log-entry';
import { NotificationService } from './notification.service';
import { TranslocoService } from '@jsverse/transloco';
import { AppSettingsService } from './app-settings.service';
import { AutoAcceptInviteRequestsAutomationConfig } from '../models/automations';
import { SleepPreparationService } from './sleep-preparation.service';
import { MessageCenterService } from './message-center/message-center.service';
import { openUrl } from '@tauri-apps/plugin-opener';
import { VRChatInviteRefusedError } from './vrchat-api/vrchat-api';
import { TelemetryService } from './telemetry/telemetry.service';

// ponytail: 200 is a guess that stays under common analytics limits; Aptabase documents none
const MAX_REFUSAL_BODY = 200;
const UUID = /\b(?:[a-z]+_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

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
    private translate: TranslocoService,
    private sleepPreparation: SleepPreparationService,
    private messageCenter: MessageCenterService,
    private telemetry: TelemetryService
  ) {}

  async init() {
    this.vrchat.notifications.subscribe((notification) => {
      void this.handleNotification(notification).catch((cause) =>
        error(`[VRChat] Failed to handle notification '${notification.id}': ${cause}`)
      );
    });
    this.handlePlayerListPresetAutomations();
  }

  private async handleNotification(notification: Notification): Promise<void> {
    switch (notification.type) {
      case NotificationType.RequestInvite:
        await this.handleRequestInviteNotification(notification);
        break;
      case NotificationType.Invite:
        await this.handleInviteNotification(notification);
        break;
    }
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
      const declined = await this.vrchat.declineInviteOrInviteRequest(
        notification.id,
        'invite',
        message
      );
      await this.vrchat.deleteNotification(notification.id);
      if (declined) {
        this.eventLog.logEvent({
          type: 'declinedInvite',
          displayName: notification.senderUsername,
          reason: 'SLEEP_MODE_ENABLED',
          message: declined.reply,
        } as EventLogDeclinedInvite);
        void this.sendInviteAutomationNotification(
          'autoDeclinedInvite',
          notification.senderUsername
        );
      }
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
    if (!user) {
      warn('[VRChat] Ignoring invite request because the current user is not available');
      return;
    }
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
              this.translate.translate(
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
      const accepted = await this.acceptInviteRequest(notification);
      this.playInviteRequestSound(config, !!accepted, sleepMode);
      if (!accepted) return;
      this.eventLog.logEvent({
        type: 'acceptedInviteRequest',
        displayName: notification.senderUsername,
        mode: 'JOIN_ME',
      } as EventLogAcceptedInviteRequest);
      return;
    }
    // Stop if sleep mode is disabled and it's required to be enabled
    if (config.onlyIfSleepModeEnabled && !sleepMode) {
      warn('[VRChat] Ignoring invite request because sleep mode is disabled');
      const declined = await this.declineInviteRequest(
        notification,
        config,
        'SLEEP_MODE_ENABLED_CONDITION_FAILED'
      );
      this.playInviteRequestSound(config, declined, sleepMode);
      return;
    }
    // Stop if there is a player count limit set, and there are more people in the instance than the limit
    if (config.onlyBelowPlayerCountEnabled) {
      const world = await firstValueFrom(this.vrchat.world);
      if (world.players.length >= config.onlyBelowPlayerCount) {
        warn(
          `[VRChat] Ignoring invite request because there are too many players in the instance (${world.players.length}>=${config.onlyBelowPlayerCount})`
        );
        const declined = await this.declineInviteRequest(
          notification,
          config,
          'PLAYER_COUNT_CONDITION_FAILED'
        );
        this.playInviteRequestSound(config, declined, sleepMode);
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
          const declined = await this.declineInviteRequest(
            notification,
            config,
            'NOT_ON_WHITELIST'
          );
          this.playInviteRequestSound(config, declined, sleepMode);
          return;
        }
        break;
      case 'BLACKLIST':
        // Stop if the player is on the blacklist
        if (config.playerIds.includes(notification.senderUserId)) {
          warn('[VRChat] Ignoring invite request because player is on blacklist');
          const declined = await this.declineInviteRequest(notification, config, 'ON_BLACKLIST');
          this.playInviteRequestSound(config, declined, sleepMode);
          return;
        }
        break;
    }
    // Invite the player
    info(`[VRChat] Automatically accepting invite request from ${notification.senderUserId}`);
    const accepted = await this.acceptInviteRequest(
      notification,
      this.getInviteRequestAcceptMessage(config)
    );
    this.playInviteRequestSound(config, !!accepted, sleepMode);
    if (!accepted) return;
    if (await this.notifications.notificationTypeEnabled('INVITE_AUTOMATIONS')) {
      await this.notifications.send(
        this.translate.translate('notifications.autoAcceptedInviteRequest.content', {
          username: notification.senderUsername,
        })
      );
    }
    this.eventLog.logEvent({
      type: 'acceptedInviteRequest',
      displayName: notification.senderUsername,
      mode: config.listMode,
      message: accepted.reply,
    } as EventLogAcceptedInviteRequest);
  }

  /** Resolves to null when VRChat refuses the invite, which leaves the request in VRChat. */
  private async acceptInviteRequest(
    notification: Notification,
    message?: string
  ): Promise<{ reply?: string } | null> {
    let reply: string | undefined;
    try {
      reply = await this.vrchat.inviteUser(notification.senderUserId, { message });
    } catch (cause) {
      if (!(cause instanceof VRChatInviteRefusedError)) throw cause;
      warn(
        `[VRChat] Could not accept the invite request from ${notification.senderUsername}: VRChat refused the invite to the current instance`
      );
      this.eventLog.logEvent({
        type: 'failedInviteRequest',
        displayName: notification.senderUsername,
        vrchatMessage: cause.vrchatMessage,
      } as EventLogFailedInviteRequest);
      void this.sendInviteAutomationNotification(
        'failedInviteRequest',
        notification.senderUsername
      );
      this.trackRefusal(cause, notification).catch((e) =>
        warn(`[VRChat] Could not report the refused invite to telemetry: ${e}`)
      );
      return null;
    }
    await this.vrchat.deleteNotification(notification.id);
    return { reply };
  }

  /** Carries the raw body, cut to MAX_REFUSAL_BODY characters, only when VRChat gave no message. */
  private async trackRefusal(refusal: VRChatInviteRefusedError, notification: Notification) {
    const user = await firstValueFrom(this.vrchat.user);
    const names = [notification.senderUsername, user?.displayName];
    const message = this.anonymizeVRChatMessage(refusal.vrchatMessage ?? '', names);
    const props: { [key: string]: string } = { message };
    if (!refusal.vrchatMessage) {
      props['body'] = this.anonymizeVRChatMessage(refusal.body, names).slice(0, MAX_REFUSAL_BODY);
    }
    await this.telemetry.trackEvent('vrchat_invite_refused', props);
  }

  /** Replaces the given display names and any VRChat ID, so the message carries no personal data. */
  private anonymizeVRChatMessage(message: string, names: (string | undefined)[]): string {
    // IDs go first: a display name can match part of an ID and break the ID match
    return names.reduce<string>(
      (text, name) => (name ? text.replaceAll(name, '<name>') : text),
      message.replace(UUID, '<id>')
    );
  }

  /** Resolves to whether the decline automation handled the request. */
  private async declineInviteRequest(
    notification: Notification,
    config: AutoAcceptInviteRequestsAutomationConfig,
    reason: EventLogDeclinedInviteRequest['reason']
  ): Promise<boolean> {
    const message = await this.getInviteRequestDeclineMessage(config);
    if (!message) return false;
    const declined = await this.vrchat.declineInviteOrInviteRequest(
      notification.id,
      'requestInvite',
      message
    );
    await this.vrchat.deleteNotification(notification.id);
    if (declined) {
      this.eventLog.logEvent({
        type: 'declinedInviteRequest',
        displayName: notification.senderUsername,
        reason,
        message: declined.reply,
      } as EventLogDeclinedInviteRequest);
      void this.sendInviteAutomationNotification(
        'autoDeclinedInviteRequest',
        notification.senderUsername
      );
    }
    return true;
  }

  private async sendInviteAutomationNotification(
    key: 'autoDeclinedInvite' | 'autoDeclinedInviteRequest' | 'failedInviteRequest',
    username: Notification['senderUsername']
  ) {
    if (!(await this.notifications.notificationTypeEnabled('INVITE_AUTOMATIONS'))) return;
    await this.notifications.send(
      this.translate.translate(`notifications.${key}.content`, { username })
    );
  }

  private getInviteRequestAcceptMessage(
    config: AutoAcceptInviteRequestsAutomationConfig
  ): string | undefined {
    if (!config.acceptMessageEnabled) return undefined;
    let message = config.acceptInviteRequestMessage;
    message = message.replace(/\s+/g, ' ').trim();
    if (message.length === 0) {
      message = this.translate.translate(
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
      message = this.translate.translate(
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
      message = this.translate.translate(
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
