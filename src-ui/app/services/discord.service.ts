import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import { asyncScheduler, distinctUntilChanged, throttleTime } from 'rxjs';
import { invoke } from '@tauri-apps/api';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class DiscordService {
  constructor(private sleepService: SleepService, private translate: TranslateService) {}

  async init() {
    this.sleepService.mode
      .pipe(
        distinctUntilChanged(),
        throttleTime(4000, asyncScheduler, { leading: true, trailing: true })
      )
      .subscribe((sleepMode) => {
        this.updateActivity(sleepMode);
      });
  }

  private async updateActivity(sleepMode: boolean) {
    await invoke<boolean>('discord_update_activity', {
      details: this.translate.instant('discord.details'),
      state: this.translate.instant(sleepMode ? 'discord.state.sleeping' : 'discord.state.awake'),
      asset_label: this.translate.instant(
        sleepMode ? 'discord.label.sleeping' : 'discord.label.awake'
      ),
      asset: sleepMode ? 'asleep' : 'awake',
    });
  }
}
