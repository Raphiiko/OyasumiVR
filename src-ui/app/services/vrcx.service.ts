import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import {
    debounceTime,
    distinctUntilChanged,
    map,
    skip,
} from 'rxjs';
import { invoke } from '@tauri-apps/api/core';
import { TranslateService } from '@ngx-translate/core';
import { SleepPreparationService } from './sleep-preparation.service';
import { info, warn } from '@tauri-apps/plugin-log';
import { AppSettingsService } from './app-settings.service';

@Injectable({
    providedIn: 'root',
})
export class VRCXService {
    private LogSleepMode = false;
    constructor(
        private sleep: SleepService,
        private sleepPreparation: SleepPreparationService,
        private translate: TranslateService,
        private appSettingsService: AppSettingsService,
    ) { }

    async init() {
        this.appSettingsService.settings.pipe(
            map((settings) => settings.vrcxLogSleepMode),
            distinctUntilChanged()
        ).subscribe(
            async (value: boolean) => {
                this.LogSleepMode = value;
            }
        )
        this.sleep.mode.pipe(
            skip(1),
            distinctUntilChanged(),
            debounceTime(300),
        ).subscribe(async sleepmode => {
            if (!this.LogSleepMode) {
                return;
            }
            if (sleepmode) {
                const msg: String = this.translate.instant("oscAutomations.general.onSleepEnable.script");
                const sucess = await invoke<boolean>("vrcx_log", { msg });
                if (sucess) {
                    info(`[VRCX] logged ${msg}`);
                } else {
                    warn(`[VRCX] failed to log ${msg}`);
                }
            } else {
                const msg: String = this.translate.instant("oscAutomations.general.onSleepDisable.script");
                const sucess = await invoke<boolean>("vrcx_log", { msg });
                if (sucess) {
                    info(`[VRCX] logged ${msg}`);
                } else {
                    warn(`[VRCX] failed to log ${msg}`);
                }
            }
        });
        this.sleepPreparation.onSleepPreparation.pipe(
            debounceTime(300),
        ).subscribe(async () => {
            if (!this.LogSleepMode) {
                return;
            }
            const msg: String = this.translate.instant("oscAutomations.general.onSleepPreparation.script");
            const sucess = await invoke<boolean>("vrcx_log", { msg });
            if (sucess) {
                info(`[VRCX] logged ${msg}`);
            } else {
                warn!(`[VRCX] failed to log ${msg}`);
            }
        });
    }
}
