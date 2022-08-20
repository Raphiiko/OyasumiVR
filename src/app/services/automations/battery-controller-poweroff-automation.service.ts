import { Injectable } from '@angular/core';
import {
  AUTOMATION_DEFAULT_CONFIG,
  ControllerPoweroffAutomationConfig,
} from '../../models/automations';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { firstValueFrom, map } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class BatteryControllerPoweroffAutomationService {
  config: ControllerPoweroffAutomationConfig = cloneDeep(
    AUTOMATION_DEFAULT_CONFIG.CONTROLLER_POWER_OFF
  );
  turnedOnControllers: number[] = [];

  constructor(private automationConfig: AutomationConfigService, private openvr: OpenVRService) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.CONTROLLER_POWER_OFF))
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
        const devices = await firstValueFrom(
          this.openvr.devices.pipe(
            map((devices) => devices.filter((device) => device.class === 'GenericTracker'))
          )
        );
        await this.openvr.turnOffDevices(devices);
      }
    });
  }
}
