import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import {
  asyncScheduler,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  throttleTime,
} from 'rxjs';
import { invoke } from '@tauri-apps/api/core';
import { TranslateService } from '@ngx-translate/core';
import { VRChatService } from './vrchat.service';
import { AppSettingsService } from './app-settings.service';

@Injectable({
  providedIn: 'root',
})
export class DiscordService {
  private activityCleared = false;

  constructor(
    private sleepService: SleepService,
    private translate: TranslateService,
    private vrchat: VRChatService,
    private appSettingsService: AppSettingsService
  ) {}

  async init() {
    combineLatest([
      this.appSettingsService.settings.pipe(
        map((settings) => settings.discordActivityMode),
        distinctUntilChanged()
      ),
      this.appSettingsService.settings.pipe(
        map((settings) => settings.discordActivityOnlyWhileVRChatIsRunning),
        distinctUntilChanged()
      ),
      this.vrchat.vrchatProcessActive.pipe(distinctUntilChanged()),
      this.sleepService.mode.pipe(distinctUntilChanged()),
    ])
      .pipe(
        debounceTime(100),
        map(([activityMode, onlyWhileVRChatIsRunning, vrchatActive, sleepMode]) => {
          if (activityMode === 'DISABLED') return null;
          if (activityMode === 'ONLY_ASLEEP' && !sleepMode) return null;
          if (onlyWhileVRChatIsRunning && !vrchatActive) return null;
          return sleepMode;
        }),
        distinctUntilChanged(),
        throttleTime(4000, asyncScheduler, { leading: true, trailing: true })
      )
      .subscribe(async (sleepMode: boolean | null) => {
        if (sleepMode === null) {
          if (!this.activityCleared) await this.clearActivity();
        } else await this.updateActivity(sleepMode);
      });
  }

  private async updateActivity(sleepMode: boolean) {
    await invoke<boolean>('discord_update_activity', {
      details: this.translate.instant('discord.details'),
      state: this.translate.instant(sleepMode ? 'discord.state.sleeping' : 'discord.state.awake'),
      assetLabel: this.translate.instant(
        sleepMode ? 'discord.label.sleeping' : 'discord.label.awake'
      ),
      asset: sleepMode ? 'asleep' : 'awake',
    });
    this.activityCleared = false;
  }

  private async clearActivity() {
    await invoke('discord_clear_activity');
    this.activityCleared = true;
  }
}
