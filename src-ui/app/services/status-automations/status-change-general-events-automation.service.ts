import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { VRChatService } from '../vrchat.service';
import { SleepService } from '../sleep.service';
import { SleepPreparationService } from '../sleep-preparation.service';
import { NotificationService } from '../notification.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  ChangeStatusGeneralEventsAutomationConfig,
} from '../../models/automations';

import { debounceTime, distinctUntilChanged, filter, map, skip } from 'rxjs';
import { UserStatus } from 'vrchat';
import { TranslateService } from '@ngx-translate/core';
import { CurrentUser } from 'vrchat/dist';
import { EventLogStatusChangedOnGeneralEvent } from '../../models/event-log-entry';
import { EventLogService } from '../event-log.service';

@Injectable({
  providedIn: 'root',
})
export class StatusChangeGeneralEventsAutomationService {
  config: ChangeStatusGeneralEventsAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_GENERAL_EVENTS
  );
  private vrcUser: CurrentUser | null = null;

  constructor(
    private automationConfig: AutomationConfigService,
    private vrchat: VRChatService,
    private sleep: SleepService,
    private sleepPreparation: SleepPreparationService,
    private notifications: NotificationService,
    private translate: TranslateService,
    private eventLog: EventLogService
  ) {}

  async init() {
    this.automationConfig.configs.subscribe((configs) => {
      this.config = structuredClone(configs.CHANGE_STATUS_GENERAL_EVENTS);
    });
    this.vrchat.user.subscribe((user) => {
      this.vrcUser = user;
    });
    this.handleSleepMode();
    this.handleSleepPreparation();
  }

  private handleSleepMode() {
    this.sleep.mode
      .pipe(
        skip(1),
        distinctUntilChanged(),
        debounceTime(3000),
        filter(() => this.config.enabled),
        filter(() => Boolean(this.vrcUser && this.vrcUser.status !== UserStatus.Offline)),
        map((sleepMode) => {
          let status: UserStatus | null = null;
          let statusMessage: string | null = null;
          if (sleepMode) {
            if (this.config.changeStatusOnSleepModeEnable)
              status = this.config.statusOnSleepModeEnable;
            if (this.config.changeStatusMessageOnSleepModeEnable)
              statusMessage = this.config.statusMessageOnSleepModeEnable;
          } else {
            if (this.config.changeStatusOnSleepModeDisable)
              status = this.config.statusOnSleepModeDisable;
            if (this.config.changeStatusMessageOnSleepModeDisable)
              statusMessage = this.config.statusMessageOnSleepModeDisable;
          }
          return { status, statusMessage, sleepMode };
        }),
        filter((data) => Boolean(data.status || data.statusMessage)),
        debounceTime(500)
      )
      .subscribe(async ({ status, statusMessage, sleepMode }) => {
        const oldStatus = this.vrcUser?.status;
        const oldStatusMessage = this.vrcUser?.statusDescription;
        await this.vrchat.setStatus(status, statusMessage);
        if (await this.notifications.notificationTypeEnabled('AUTO_UPDATED_VRC_STATUS')) {
          await this.notifications.send(
            this.translate.instant('notifications.vrcStatusChanged.content', {
              newStatus: (
                (statusMessage ?? oldStatusMessage) +
                ' (' +
                (status ?? oldStatus) +
                ')'
              ).trim(),
            })
          );
        }
        this.eventLog.logEvent({
          type: 'statusChangedOnGeneralEvent',
          reason: sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED',
          newStatus: status,
          oldStatus: oldStatus,
          newStatusMessage: statusMessage,
          oldStatusMessage: oldStatusMessage,
        } as EventLogStatusChangedOnGeneralEvent);
      });
  }

  private handleSleepPreparation() {
    this.sleepPreparation.onSleepPreparation
      .pipe(
        filter(() => this.config.enabled),
        filter(() => Boolean(this.vrcUser && this.vrcUser.status !== UserStatus.Offline)),
        map(() => {
          const status: UserStatus | null = this.config.changeStatusOnSleepPreparation
            ? this.config.statusOnSleepPreparation
            : null;
          const statusMessage: string | null = this.config.changeStatusMessageOnSleepPreparation
            ? this.config.statusMessageOnSleepPreparation
            : null;
          return { status, statusMessage };
        }),
        filter((data) => Boolean(data.status || data.statusMessage)),
        debounceTime(500)
      )
      .subscribe(async ({ status, statusMessage }) => {
        const oldStatus = this.vrcUser?.status;
        const oldStatusMessage = this.vrcUser?.statusDescription;
        await this.vrchat.setStatus(status, statusMessage);
        if (await this.notifications.notificationTypeEnabled('AUTO_UPDATED_VRC_STATUS')) {
          await this.notifications.send(
            this.translate.instant('notifications.vrcStatusChanged.content', {
              newStatus: (
                (statusMessage ?? oldStatusMessage) +
                ' (' +
                (status ?? oldStatus) +
                ')'
              ).trim(),
            })
          );
        }
        this.eventLog.logEvent({
          type: 'statusChangedOnGeneralEvent',
          reason: 'SLEEP_PREPARATION',
          newStatus: status,
          oldStatus: oldStatus,
          newStatusMessage: statusMessage,
          oldStatusMessage: oldStatusMessage,
        } as EventLogStatusChangedOnGeneralEvent);
      });
  }
}
