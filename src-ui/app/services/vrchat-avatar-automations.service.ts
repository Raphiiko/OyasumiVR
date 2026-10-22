import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { debounceTime, distinctUntilChanged, map, skip } from 'rxjs';
import { SleepService } from './sleep.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { VRChatAvatarAutomationsConfig } from '../models/automations';
import { VRChatService } from './vrchat-api/vrchat.service';
import { EventLogService } from './event-log.service';
import { EventLogFailure, EventLogVRChatAvatarChanged } from '../models/event-log-entry';
import { vrchatFailure } from './vrchat-api/vrchat-api';
import { error } from '@tauri-apps/plugin-log';

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
      .subscribe((sleepMode) => {
        void this.onSleepModeChange(sleepMode).catch((cause) =>
          error(`[VRChat] Failed to apply sleep mode avatar: ${cause}`)
        );
      });
    this.sleepPreparation.onSleepPreparation.subscribe(() => {
      void this.onSleepPreparation().catch((cause) =>
        error(`[VRChat] Failed to apply sleep preparation avatar: ${cause}`)
      );
    });
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (sleepMode && this.config?.onSleepEnable) {
      await this.selectAvatar(this.config.onSleepEnable, 'SLEEP_MODE_ENABLED');
    }
    if (!sleepMode && this.config?.onSleepDisable) {
      await this.selectAvatar(this.config.onSleepDisable, 'SLEEP_MODE_DISABLED');
    }
  }

  private async onSleepPreparation() {
    if (this.config?.onSleepPreparation) {
      await this.selectAvatar(this.config.onSleepPreparation, 'SLEEP_PREPARATION');
    }
  }

  private async selectAvatar(
    avatar: { id: string; name: string },
    reason: EventLogVRChatAvatarChanged['reason']
  ) {
    let failure: EventLogFailure | undefined;
    try {
      await this.vrchat.selectAvatar(avatar.id);
    } catch (e) {
      failure = vrchatFailure(e, 'VRCHAT_AVATAR_UNAVAILABLE');
      if (!failure) return;
      error(`[VRChat] Failed to select avatar for ${reason}: ${e}`);
    }
    this.eventLog.logEvent({
      type: 'vrchatAvatarChanged',
      avatarName: avatar.name,
      reason,
      failure,
    });
  }
}
