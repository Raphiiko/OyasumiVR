import { Injectable } from '@angular/core';
import { VRChatService } from '../vrchat.service';
import {
  async,
  combineLatest,
  debounceTime,
  filter,
  map,
  pairwise,
  startWith,
  switchMap,
  throttleTime,
} from 'rxjs';
import { AutomationConfigService } from '../automation-config.service';
import { isEqual } from 'lodash';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  ChangeStatusBasedOnPlayerCountAutomationConfig,
} from '../../models/automations';
import { SleepService } from '../sleep.service';
import { WorldContext } from '../../models/vrchat';
import { CurrentUser, UserStatus } from 'vrchat/dist';
import { info } from 'tauri-plugin-log-api';
import { EventLogService } from '../event-log.service';
import { EventLogStatusChangedOnPlayerCountChange } from '../../models/event-log-entry';
import { NotificationService } from '../notification.service';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class StatusChangeForPlayerCountAutomationService {
  constructor(
    private vrchat: VRChatService,
    private automationConfig: AutomationConfigService,
    private sleep: SleepService,
    private eventLog: EventLogService,
    private notifications: NotificationService,
    private translate: TranslateService
  ) {}

  async init() {
    combineLatest([
      this.vrchat.world.pipe(debounceTime(100)),
      this.sleep.mode,
      this.vrchat.user.pipe(filter((user) => !!user)),
      this.automationConfig.configs.pipe(
        map((c) => c.CHANGE_STATUS_BASED_ON_PLAYER_COUNT),
        startWith(AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_BASED_ON_PLAYER_COUNT),
        pairwise(),
        filter(([prev, next]) => !isEqual(prev, next)),
        map(([, next]) => next)
      ),
    ])
      .pipe(
        // Stop if automation is disabled
        filter(([, , , config]) => config.enabled),
        // Stop if sleep mode is disabled and it's required to be enabled
        filter(
          ([, sleepModeEnabled, , config]) => !config.onlyIfSleepModeEnabled || sleepModeEnabled
        ),
        // Determine new status to be set
        map(
          ([worldContext, , user, config]: [
            WorldContext,
            boolean,
            CurrentUser | null,
            ChangeStatusBasedOnPlayerCountAutomationConfig
          ]) => ({
            newStatus:
              worldContext.playerCount < config.limit
                ? config.statusBelowLimit
                : config.statusAtLimitOrAbove,
            oldStatus: user!.status,
            reason: worldContext.playerCount < config.limit ? 'BELOW_LIMIT' : 'AT_LIMIT_OR_ABOVE',
            threshold: config.limit,
          })
        ),
        // Stop if status is already set or user is offline
        filter(
          ({ newStatus, oldStatus }) => newStatus !== oldStatus && oldStatus !== UserStatus.Offline
        ),
        // Throttle to prevent spamming, just in case. (This should already be handled at the service level).
        throttleTime(500, async, { leading: true, trailing: true }),
        // Set the status
        switchMap(({ oldStatus, newStatus, reason, threshold }) => {
          info(
            `[StatusChangeForPlayerCountAutomation] Detected changed conditions, setting new status...`
          );

          return this.vrchat.setStatus(newStatus).then(async () => {
            if (
              await this.notifications.notificationTypeEnabled('AUTO_UPDATED_STATUS_PLAYERCOUNT')
            ) {
              await this.notifications.send(
                this.translate.instant('notifications.vrcStatusChangedPlayerCount.content', {
                  newStatus,
                })
              );
            }
            this.eventLog.logEvent({
              type: 'statusChangedOnPlayerCountChange',
              reason,
              threshold,
              newStatus,
              oldStatus,
            } as EventLogStatusChangedOnPlayerCountChange);
          });
        })
      )
      .subscribe();
  }
}
