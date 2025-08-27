import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import { distinctUntilChanged, skip } from 'rxjs';
import { invoke } from '@tauri-apps/api/core';
import { TranslateService } from '@ngx-translate/core';
import { SleepPreparationService } from './sleep-preparation.service';
import { AppSettingsService } from './app-settings.service';

@Injectable({
  providedIn: 'root',
})
export class VRCXService {
  constructor(
    private sleep: SleepService,
    private sleepPreparation: SleepPreparationService,
    private translate: TranslateService,
    private appSettingsService: AppSettingsService
  ) {}

  async init() {
    // Log sleep mode to VRCX
    this.sleep.mode.pipe(skip(1), distinctUntilChanged()).subscribe(async (sleepMode) => {
      if (this.appSettingsService.settingsSync.vrcxLogsEnabled.includes('SleepMode')) {
        await invoke<boolean>('vrcx_log', {
          msg: this.translate.instant(
            `settings.integrations.vrcx.logs.${sleepMode ? 'onSleepEnable' : 'onSleepDisable'}`
          ),
        });
      }
    });
    // Log sleep preparation to VRCX
    this.sleepPreparation.onSleepPreparation.subscribe(async () => {
      if (this.appSettingsService.settingsSync.vrcxLogsEnabled.includes('SleepMode')) {
        await invoke<boolean>('vrcx_log', {
          msg: this.translate.instant('settings.integrations.vrcx.logs.onSleepPreparation'),
        });
      }
    });
  }
}
