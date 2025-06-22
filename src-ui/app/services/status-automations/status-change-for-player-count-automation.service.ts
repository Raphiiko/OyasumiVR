import { Injectable } from '@angular/core';
import { VRChatService } from '../vrchat-api/vrchat.service';
import {
  asyncScheduler,
  combineLatest,
  debounceTime,
  delay,
  distinctUntilChanged,
  filter,
  map,
  throttleTime,
} from 'rxjs';
import { AutomationConfigService } from '../automation-config.service';
import { isEqual } from 'lodash';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  ChangeStatusBasedOnPlayerCountAutomationConfig,
} from '../../models/automations';
import { SleepService } from '../sleep.service';
import { CurrentUser, UserStatus } from 'vrchat/dist';
import { EventLogService } from '../event-log.service';
import { EventLogStatusChangedOnPlayerCountChange } from '../../models/event-log-entry';
import { NotificationService } from '../notification.service';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class StatusChangeForPlayerCountAutomationService {
  private config: ChangeStatusBasedOnPlayerCountAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_BASED_ON_PLAYER_COUNT
  );
  private sleepMode = false;

  constructor(
    private vrchat: VRChatService,
    private automationConfig: AutomationConfigService,
    private sleep: SleepService,
    private eventLog: EventLogService,
    private notifications: NotificationService,
    private translate: TranslateService
  ) {}

  async init() {
    // Pull in data
    this.automationConfig.configs.subscribe((configs) => {
      this.config = structuredClone(configs.CHANGE_STATUS_BASED_ON_PLAYER_COUNT);
    });
    this.sleep.mode.subscribe((mode) => (this.sleepMode = mode));

    combineLatest([
      // React to player count changes
      this.vrchat.world.pipe(
        filter((w) => w.loaded),
        map((w) => w.players.length),
        debounceTime(1000)
      ),
      // React to the user logging in
      this.vrchat.user.pipe(filter((user) => !!user)),
      // React to the automation config changing
      this.automationConfig.configs.pipe(
        debounceTime(1000),
        map((c) => c.CHANGE_STATUS_BASED_ON_PLAYER_COUNT),
        distinctUntilChanged((a, b) => isEqual(a, b)),
        delay(100)
      ),
    ])
      .pipe(
        // Automation must be enabled
        filter(() => this.config.enabled),
        // Sleep mode condition must be met or disabled
        filter(() => this.sleepMode || !this.config.onlyIfSleepModeEnabled),
        // User must be currently online
        filter(([, user]) => !!user && user.status !== UserStatus.Offline),
        // Determine the new status
        map(([playerCount, user]) => this.determineNewStatus(playerCount, user!)),
        // Stop if we don't need to make any changes
        filter((newStatus) => Boolean(newStatus.status || newStatus.statusMessage)),
        // Throttle to prevent spamming, just in case. (This should already be handled at the service level).
        throttleTime(500, asyncScheduler, { leading: true, trailing: true })
      )
      .subscribe(async (newStatus) => {
        // Set new status
        const success = await this.vrchat
          .setStatus(newStatus.status, newStatus.statusMessage)
          .catch(() => false);
        if (success) {
          if (await this.notifications.notificationTypeEnabled('AUTO_UPDATED_VRC_STATUS')) {
            await this.notifications.send(
              this.translate.instant('notifications.vrcStatusChanged.content', {
                newStatus: (
                  (newStatus.statusMessage ?? newStatus.oldStatusMessage) +
                  ' (' +
                  (newStatus.status ?? newStatus.oldStatus) +
                  ')'
                ).trim(),
              })
            );
          }
          this.eventLog.logEvent({
            type: 'statusChangedOnPlayerCountChange',
            reason: newStatus.reason,
            threshold: this.config.limit,
            newStatus: newStatus.status,
            oldStatus: newStatus.oldStatus,
            newStatusMessage: newStatus.statusMessage,
            oldStatusMessage: newStatus.oldStatusMessage,
          } as EventLogStatusChangedOnPlayerCountChange);
        }
      });
  }

  private determineNewStatus(playerCount: number, user: CurrentUser) {
    const newStatus: {
      oldStatus: UserStatus;
      oldStatusMessage: string;
      status: UserStatus | null;
      statusMessage: string | null;
      reason: 'BELOW_LIMIT' | 'AT_LIMIT_OR_ABOVE';
    } = {
      oldStatus: user.status,
      oldStatusMessage: user.statusDescription,
      status: null,
      statusMessage: null,
      reason: playerCount < this.config.limit ? 'BELOW_LIMIT' : 'AT_LIMIT_OR_ABOVE',
    };
    // Determine status we're supposed to set
    if (playerCount < this.config.limit) {
      newStatus.status = this.config.statusBelowLimitEnabled ? this.config.statusBelowLimit : null;
      newStatus.statusMessage = this.config.statusMessageBelowLimitEnabled
        ? this.config.statusMessageBelowLimit
        : null;
    } else {
      newStatus.status = this.config.statusAtLimitOrAboveEnabled
        ? this.config.statusAtLimitOrAbove
        : null;
      newStatus.statusMessage = this.config.statusMessageAtLimitOrAboveEnabled
        ? this.config.statusMessageAtLimitOrAbove
        : null;
    }
    // Diff it against the current user and remove any values that are the same
    if (newStatus.status === user.status) {
      newStatus.status = null;
    }
    if (newStatus.statusMessage === user.statusDescription) {
      newStatus.statusMessage = null;
    }
    return newStatus;
  }
}
