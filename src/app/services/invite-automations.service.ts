import { Injectable } from '@angular/core';
import { VRChatService } from './vrchat.service';
import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
import { Notification, NotificationType, UserStatus } from 'vrchat';
import { info, warn } from 'tauri-plugin-log-api';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class InviteAutomationsService {
  constructor(
    private vrchat: VRChatService,
    private automationConfig: AutomationConfigService,
    private sleep: SleepService
  ) {}

  async init() {
    this.vrchat.notifications.subscribe(async (notification) => {
      switch (notification.type) {
        case NotificationType.RequestInvite:
          await this.handleRequestInviteNotification(notification);
          break;
      }
    });
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
  }
}
