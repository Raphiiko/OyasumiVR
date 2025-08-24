import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import {
    debounceTime,
    distinctUntilChanged,
    skip,
} from 'rxjs';
import { invoke } from '@tauri-apps/api/core';
import { TranslateService } from '@ngx-translate/core';
import { SleepPreparationService } from './sleep-preparation.service';
import { info, warn } from '@tauri-apps/plugin-log';

@Injectable({
    providedIn: 'root',
})
export class VRCXService {

    constructor(
        private sleep: SleepService,
        private sleepPreparation: SleepPreparationService,
        private translate: TranslateService,
    ) { }

    async init() {
        this.sleep.mode.pipe(
            skip(1),
            distinctUntilChanged(),
            debounceTime(300),
        ).subscribe(async sleepmode => {
            if (sleepmode) {
                info("[VRCX] onSleepEnable");
                const msg: String = this.translate.instant("oscAutomations.general.onSleepEnable.script");
                const sucess = await invoke<boolean>("vrcx_log", { msg });
                if (sucess) {
                    info(`[VRCX] logged ${msg}`);
                } else {
                    warn(`[VRCX] failed to log ${msg}`);
                }
            } else {
                info("[VRCX] onSleepDisable");
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
            info("[VRCX] onSleepPreparation");
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
