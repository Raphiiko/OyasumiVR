import { Injectable } from '@angular/core';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { distinctUntilChanged, filter, firstValueFrom, map } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  TurnOffDevicesOnSleepModeEnableAutomationConfig,
  TurnOffDevicesWhenChargingAutomationConfig,
} from '../../models/automations';
import { LighthouseService } from '../lighthouse.service';
import { SleepModeService } from '../sleep-mode.service';

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
    private sleepMode: SleepModeService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE))
      .subscribe((config) => (this.config = config));

    this.sleepMode.sleepMode
      .pipe(
        filter((sleepMode) => sleepMode),
      )
      .subscribe(async () => {
        const devices = (await firstValueFrom(this.openvr.devices)).filter((d) =>
          this.config.deviceClasses.includes(d.class)
        );
        await this.lighthouse.turnOffDevices(devices);
      });
  }
}
