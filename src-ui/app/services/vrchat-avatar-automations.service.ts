import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { debounceTime, distinctUntilChanged, map, skip } from 'rxjs';
import { SleepService } from './sleep.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { VRChatAvatarAutomationsConfig } from '../models/automations';
import { VRChatService } from './vrchat.service';

@Injectable({
  providedIn: 'root',
})
export class VRChatAvatarAutomationsService {
  private config?: VRChatAvatarAutomationsConfig;

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private vrchat: VRChatService,
    private sleepPreparation: SleepPreparationService
  ) {}

  async init() {
    this.automationConfigService.configs
      .pipe(map((c) => c.VRCHAT_AVATAR_AUTOMATIONS))
      .subscribe((c) => (this.config = c));
    this.sleepService.mode
      .pipe(distinctUntilChanged(), skip(1), debounceTime(5000))
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
    this.sleepPreparation.onSleepPreparation.subscribe(() => this.onSleepPreparation());
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (sleepMode && this.config?.onSleepEnable) {
      await this.vrchat.selectAvatar(this.config.onSleepEnable.id);
      // TODO: LOG
    }
    if (!sleepMode && this.config?.onSleepDisable) {
      await this.vrchat.selectAvatar(this.config.onSleepDisable.id);
      // TODO: LOG
    }
  }

  private async onSleepPreparation() {
    if (this.config?.onSleepPreparation) {
      await this.vrchat.selectAvatar(this.config.onSleepPreparation.id);
      // TODO: LOG
    }
  }
}
