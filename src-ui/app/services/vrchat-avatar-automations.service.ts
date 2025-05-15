import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { debounceTime, distinctUntilChanged, map, skip } from 'rxjs';
import { SleepService } from './sleep.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { VRChatAvatarAutomationsConfig } from '../models/automations';
import { VRChatService } from './vrchat-api/vrchat.service';
import { EventLogService } from './event-log.service';
import { EventLogVRChatAvatarChanged } from '../models/event-log-entry';

@Injectable({
  providedIn: 'root',
})
export class VRChatAvatarAutomationsService {
  private config?: VRChatAvatarAutomationsConfig;

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private vrchat: VRChatService,
    private sleepPreparation: SleepPreparationService,
    private eventLog: EventLogService
  ) {}

  async init() {
    this.automationConfigService.configs
      .pipe(map((c) => c.VRCHAT_AVATAR_AUTOMATIONS))
      .subscribe((c) => (this.config = c));
    this.sleepService.mode
      .pipe(distinctUntilChanged(), skip(1), debounceTime(3000))
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
    this.sleepPreparation.onSleepPreparation.subscribe(() => this.onSleepPreparation());
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (sleepMode && this.config?.onSleepEnable) {
      await this.vrchat.selectAvatar(this.config.onSleepEnable.id);
      this.eventLog.logEvent({
        type: 'vrchatAvatarChanged',
        avatarName: this.config.onSleepEnable.name,
        reason: 'SLEEP_MODE_ENABLED',
      } as EventLogVRChatAvatarChanged);
    }
    if (!sleepMode && this.config?.onSleepDisable) {
      await this.vrchat.selectAvatar(this.config.onSleepDisable.id);
      this.eventLog.logEvent({
        type: 'vrchatAvatarChanged',
        avatarName: this.config.onSleepDisable.name,
        reason: 'SLEEP_MODE_DISABLED',
      } as EventLogVRChatAvatarChanged);
    }
  }

  private async onSleepPreparation() {
    if (this.config?.onSleepPreparation) {
      await this.vrchat.selectAvatar(this.config.onSleepPreparation.id);
      this.eventLog.logEvent({
        type: 'vrchatAvatarChanged',
        avatarName: this.config.onSleepPreparation.name,
        reason: 'SLEEP_PREPARATION',
      } as EventLogVRChatAvatarChanged);
    }
  }
}
