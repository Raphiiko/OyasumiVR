import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import { distinctUntilChanged, skip } from 'rxjs';
import { invoke } from '@tauri-apps/api/core';
import { TranslocoService } from '@jsverse/transloco';
import { SleepPreparationService } from './sleep-preparation.service';
import { AppSettingsService } from './app-settings.service';
import { EventLogService } from './event-log.service';
import {
  EventLogAcceptedInviteRequest,
  EventLogDeclinedInvite,
  EventLogDeclinedInviteRequest,
  EventLogEntry,
  EventLogStatusChangedOnGeneralEvent,
  EventLogStatusChangedOnPlayerCountChange,
  EventLogVRChatGroupChanged,
} from '../models/event-log-entry';
import { VRCXEventLogType } from '../models/settings';
import { vrcStatusToString } from '../utils/status-utils';

@Injectable({
  providedIn: 'root',
})
export class VRCXService {
  constructor(
    private sleep: SleepService,
    private sleepPreparation: SleepPreparationService,
    private translate: TranslocoService,
    private appSettingsService: AppSettingsService,
    private eventLog: EventLogService
  ) {}

  async init() {
    this.sleep.mode.pipe(skip(1), distinctUntilChanged()).subscribe((sleepMode) => {
      this.log(
        'SleepMode',
        this.translate.translate(
          `settings.integrations.vrcx.logEntries.${sleepMode ? 'onSleepEnable' : 'onSleepDisable'}`
        )
      );
    });
    this.sleepPreparation.onSleepPreparation.subscribe(() => {
      this.log(
        'SleepMode',
        this.translate.translate('settings.integrations.vrcx.logEntries.onSleepPreparation')
      );
    });
    this.eventLog.loggedEvents.subscribe((entry) => this.logEventLogEntry(entry));
  }

  private log(type: VRCXEventLogType, msg: string) {
    if (!this.appSettingsService.settingsSync.vrcxLogsEnabled.includes(type)) return;
    void invoke<boolean>('vrcx_log', { msg });
  }

  private logEventLogEntry(entry: EventLogEntry) {
    switch (entry.type) {
      case 'acceptedInviteRequest':
      case 'declinedInviteRequest':
      case 'declinedInvite':
        this.log('Invites', this.inviteMessage(entry));
        break;
      case 'statusChangedOnGeneralEvent':
      case 'statusChangedOnPlayerCountChange':
        this.log('StatusChanges', this.statusMessage(entry));
        break;
      case 'vrchatGroupChanged':
        this.log('GroupChanges', this.groupMessage(entry));
        break;
    }
  }

  private inviteMessage(
    entry: EventLogAcceptedInviteRequest | EventLogDeclinedInviteRequest | EventLogDeclinedInvite
  ): string {
    const reasonKey =
      entry.type === 'acceptedInviteRequest'
        ? {
            DISABLED: 'subtitle.anyone',
            WHITELIST: 'subtitle.whitelist',
            BLACKLIST: 'subtitle.blacklist',
            JOIN_ME: 'subtitle.joinMe',
          }[entry.mode]
        : `reason.${entry.reason}`;
    return this.join(
      this.eventLogText(entry.type, 'title', { displayName: entry.displayName }),
      reasonKey && this.eventLogText(entry.type, reasonKey),
      entry.message &&
        this.translate.translate('settings.integrations.vrcx.logEntries.reply', {
          message: entry.message,
        })
    );
  }

  private statusMessage(
    entry: EventLogStatusChangedOnGeneralEvent | EventLogStatusChangedOnPlayerCountChange
  ): string {
    const status = vrcStatusToString(entry.newStatus ?? entry.oldStatus);
    const statusMessage = (entry.newStatusMessage ?? entry.oldStatusMessage)?.trim();
    return this.join(
      this.translate.translate('settings.integrations.vrcx.logEntries.statusChanged', {
        status: statusMessage ? `'${statusMessage}' (${status})` : status,
      }),
      this.eventLogText(entry.type, `reason.${entry.reason}`, {
        threshold: 'threshold' in entry ? entry.threshold.toString() : '',
      })
    );
  }

  private groupMessage(entry: EventLogVRChatGroupChanged): string {
    return this.join(
      this.eventLogText(entry.type, entry.isClearing ? 'title.clear' : 'title.set', {
        groupName: entry.groupName || entry.groupId,
      }),
      entry.reason && this.eventLogText(entry.type, `reason.${entry.reason}`)
    );
  }

  private eventLogText(type: string, key: string, params?: Record<string, string>): string {
    return this.translate.translate(`comp.event-log-entry.type.${type}.${key}`, params);
  }

  private join(...parts: (string | null | undefined)[]): string {
    return parts.filter(Boolean).join(' | ');
  }
}
