import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeChangeOnSteamVRStatusAutomationConfig,
} from '../../models/automations';
import { cloneDeep } from 'lodash';
import { debounceTime, map, pairwise, tap } from 'rxjs';
import { SleepService } from '../sleep.service';

@Injectable({
  providedIn: 'root',
})
export class SleepModeChangeOnSteamVRStatusAutomationService {
  private config: SleepModeChangeOnSteamVRStatusAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS
  );

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private sleep: SleepService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS))
      .subscribe((config) => (this.config = config));

    this.openvr.status
      .pipe(
        map((status) => status === 'INITIALIZED'),
        debounceTime(2000),
        pairwise(),
        tap(([initializedBefore, initializedAfter]) => {
          if (initializedBefore && !initializedAfter && this.config.disableOnSteamVRStop) {
            this.sleep.disableSleepMode({
              type: 'AUTOMATION',
              automation: 'SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS',
            });
          }
        })
      )
      .subscribe();
  }
}
