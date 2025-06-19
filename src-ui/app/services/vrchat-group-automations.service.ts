import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { debounceTime, distinctUntilChanged, map, skip } from 'rxjs';
import { SleepService } from './sleep.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { VRChatGroupAutomationsConfig } from '../models/automations';
import { VRChatService } from './vrchat-api/vrchat.service';
import { EventLogService } from './event-log.service';
import { EventLogVRChatGroupChanged } from '../models/event-log-entry';

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
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
    this.sleepPreparation.onSleepPreparation.subscribe(() => this.onSleepPreparation());
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
    if (groupId) {
      await this.vrchat.representGroup(groupId, true);

      let groups = await this.vrchat.getUserGroups();
      let group = groups.find((g) => g.groupId === groupId);
      if (!group) {
        groups = await this.vrchat.getUserGroups(true);
        group = groups.find((g) => g.groupId === groupId);
      }

      this.eventLog.logEvent({
        type: 'vrchatGroupChanged',
        groupId,
        groupName: group?.name || groupId,
        isClearing: false,
        reason,
      } as EventLogVRChatGroupChanged);
    } else {
      let groups = await this.vrchat.getUserGroups();
      let group = groups.find((g) => g.isRepresenting);
      if (!group) {
        groups = await this.vrchat.getUserGroups(true);
        group = groups.find((g) => g.isRepresenting);
      }

      if (group) {
        const groupId = group.groupId!;

        await this.vrchat.representGroup(groupId, false);

        this.eventLog.logEvent({
          type: 'vrchatGroupChanged',
          groupId,
          groupName: group.name || groupId,
          isClearing: true,
          reason,
        } as EventLogVRChatGroupChanged);
      }
    }
  }
}
