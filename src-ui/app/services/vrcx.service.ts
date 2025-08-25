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
    this.sleep.mode.pipe(skip(1), distinctUntilChanged()).subscribe(async (sleepmode) => {
      if (this.appSettingsService.settingsSync.vrcxLogsEnabled.includes('SleepMode')) {
        if (sleepmode) {
          const msg: string = this.translate.instant('oscAutomations.general.onSleepEnable.script');
          const _ = await invoke<boolean>('vrcx_log', { msg });
        } else {
          const msg: string = this.translate.instant(
            'oscAutomations.general.onSleepDisable.script'
          );
          const _ = await invoke<boolean>('vrcx_log', { msg });
        }
      }
    });
    this.sleepPreparation.onSleepPreparation.subscribe(async () => {
      if (this.appSettingsService.settingsSync.vrcxLogsEnabled.includes('SleepMode')) {
        const msg: string = this.translate.instant(
          'oscAutomations.general.onSleepPreparation.script'
        );
        const _ = await invoke<boolean>('vrcx_log', { msg });
      }
    });
  }
}
