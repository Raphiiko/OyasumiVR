import { Injectable } from '@angular/core';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { filter, firstValueFrom, map, skip } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  TurnOffDevicesOnSleepModeEnableAutomationConfig,
} from '../../models/automations';
import { LighthouseService } from '../lighthouse.service';
import { SleepService } from '../sleep.service';

@Injectable({
  providedIn: 'root',
})
export class TurnOffDevicesOnSleepModeEnableAutomationService {
  config: TurnOffDevicesOnSleepModeEnableAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE
  );
  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private lighthouse: LighthouseService,
    private sleepMode: SleepService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE))
      .subscribe((config) => (this.config = config));

    this.sleepMode.mode
      .pipe(
        skip(1), // Skip first value from initial load
        filter((sleepMode) => sleepMode)
      )
      .subscribe(async () => {
        const devices = (await firstValueFrom(this.openvr.devices)).filter((d) =>
          this.config.deviceClasses.includes(d.class)
        );
        await this.lighthouse.turnOffDevices(devices);
      });
  }
}
