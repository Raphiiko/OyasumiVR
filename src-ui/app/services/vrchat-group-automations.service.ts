import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { debounceTime, distinctUntilChanged, map, skip } from 'rxjs';
import { SleepService } from './sleep.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { VRChatGroupAutomationsConfig } from '../models/automations';
import { VRChatService } from './vrchat-api/vrchat.service';
import { EventLogService } from './event-log.service';
import { EventLogFailure } from '../models/event-log-entry';
import { error } from '@tauri-apps/plugin-log';
import { VRCHAT_API_STALE_REQUEST, vrchatFailure } from './vrchat-api/vrchat-api';
import type { LimitedUserGroups } from 'vrchat';

@Injectable({
  providedIn: 'root',
})
export class VRChatGroupAutomationsService {
  private config?: VRChatGroupAutomationsConfig;

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private vrchat: VRChatService,
    private sleepPreparation: SleepPreparationService,
    private eventLog: EventLogService
  ) {}

  async init() {
    this.automationConfigService.configs
      .pipe(map((c) => c.VRCHAT_GROUP_AUTOMATIONS))
      .subscribe((c) => (this.config = c));
    this.sleepService.mode
      .pipe(distinctUntilChanged(), skip(1), debounceTime(3000))
      .subscribe((sleepMode) => this.runAutomation(this.onSleepModeChange(sleepMode)));
    this.sleepPreparation.onSleepPreparation.subscribe(() =>
      this.runAutomation(this.onSleepPreparation())
    );
  }

  private runAutomation(automation: Promise<void>) {
    void automation.catch((e) => {
      if (e !== VRCHAT_API_STALE_REQUEST) error(`[VRChat] Group automation failed: ${e}`);
    });
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (!this.config) return;
    let groupId: string | null = sleepMode
      ? this.config.representGroupIdOnSleepModeEnable
      : this.config.representGroupIdOnSleepModeDisable;
    switch (groupId) {
      case 'DONT_CHANGE':
        return;
      case 'CLEAR_GROUP':
        groupId = null;
        break;
      default:
        groupId = groupId ?? null;
    }
    await this.representGroup(groupId, sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED');
  }

  private async onSleepPreparation() {
    if (!this.config) return;
    let groupId: string | null = this.config.representGroupIdOnSleepPreparation;
    switch (groupId) {
      case 'DONT_CHANGE':
        return;
      case 'CLEAR_GROUP':
        groupId = null;
        break;
      default:
        groupId = groupId ?? null;
    }
    await this.representGroup(groupId, 'SLEEP_PREPARATION');
  }

  private async representGroup(
    groupId: string | null,
    reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION'
  ) {
    let group: LimitedUserGroups | undefined;
    let failure: EventLogFailure | undefined;
    try {
      if (groupId) {
        await this.vrchat.representGroup(groupId, true);
        group = await this.findGroup((g) => g.groupId === groupId).catch(() => undefined);
      } else {
        group = await this.findGroup((g) => g.isRepresenting);
        if (!group) return;
        await this.vrchat.representGroup(group.groupId!, false);
      }
    } catch (e) {
      failure = vrchatFailure(e, groupId ? 'VRCHAT_NOT_GROUP_MEMBER' : undefined);
      if (!failure) return;
      error(`[VRChat] Group automation failed: ${e}`);
      if (groupId)
        group = await this.findGroup((g) => g.groupId === groupId).catch(() => undefined);
    }
    const id = groupId ?? group?.groupId ?? '';
    this.eventLog.logEvent({
      type: 'vrchatGroupChanged',
      groupId: id,
      groupName: group?.name || id,
      isClearing: !groupId,
      reason,
      failure,
    });
  }

  /** Looks in the cached groups first, then asks VRChat. */
  private async findGroup(predicate: (group: LimitedUserGroups) => boolean | undefined) {
    const group = (await this.vrchat.getUserGroups()).find(predicate);
    return group ?? (await this.vrchat.getUserGroups(true)).find(predicate);
  }
}
