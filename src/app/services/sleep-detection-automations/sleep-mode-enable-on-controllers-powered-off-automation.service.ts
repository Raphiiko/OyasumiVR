import { Injectable } from '@angular/core';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { map } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeEnableAtControllersPoweredOffAutomationConfig,
} from '../../models/automations';
import { SleepModeService } from '../sleep-mode.service';

@Injectable({
  providedIn: 'root',
})
export class SleepModeEnableOnControllersPoweredOffAutomationService {
  private config: SleepModeEnableAtControllersPoweredOffAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF
  );
  private turnedOnControllers: number[] = [];

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private sleepModeService: SleepModeService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF))
      .subscribe((config) => (this.config = config));

    this.openvr.devices.subscribe(async (devices) => {
      const controllers = devices.filter((d) => d.class === 'Controller');
      controllers.forEach((controller) => {
        if (controller.canPowerOff && !this.turnedOnControllers.includes(controller.index))
          this.turnedOnControllers.push(controller.index);
      });
      const justTurnedOffControllers = controllers.filter(
        (c) => !c.canPowerOff && this.turnedOnControllers.includes(c.index)
      );
      const allTurnedOff =
        justTurnedOffControllers.length &&
        justTurnedOffControllers.length === this.turnedOnControllers.length;
      justTurnedOffControllers.forEach(
        (c) => (this.turnedOnControllers = this.turnedOnControllers.filter((_c) => _c !== c.index))
      );
      if (allTurnedOff && this.config.enabled) {
        this.sleepModeService.enableSleepMode({
          type: 'AUTOMATION',
          automation: 'SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF',
        });
      }
    });
  }
}
