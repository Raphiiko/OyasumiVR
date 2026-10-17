import { Injectable } from '@angular/core';

import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { map } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeEnableAtControllersPoweredOffAutomationConfig,
} from '../../models/automations';
import { SleepService } from '../sleep.service';
import { OVRDevice } from '../../models/ovr-device';

@Injectable({
  providedIn: 'root',
})
export class SleepModeEnableOnControllersPoweredOffAutomationService {
  private config: SleepModeEnableAtControllersPoweredOffAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF
  );
  private turnedOnControllers: number[] = [];

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private sleep: SleepService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF))
      .subscribe((config) => (this.config = config));

    this.openvr.devices.subscribe((devices) => this.onDevicesUpdate(devices));
  }

  private onDevicesUpdate(devices: OVRDevice[]) {
    const controllers = devices.filter((d) => d.class === 'Controller');

    // forget controllers whose state is gone, such as after SteamVR stops
    this.turnedOnControllers = this.turnedOnControllers.filter((index) =>
      controllers.some((c) => c.index === index)
    );

    // track controllers that are on and can be turned off
    controllers.forEach((controller) => {
      if (
        controller.canPowerOff &&
        controller.isConnected &&
        !this.turnedOnControllers.includes(controller.index)
      )
        this.turnedOnControllers.push(controller.index);
    });

    // a controller is off once it disconnects, not when it can no longer be turned off
    const justTurnedOffControllers = controllers.filter(
      (c) => !c.isConnected && this.turnedOnControllers.includes(c.index)
    );
    const allTurnedOff =
      justTurnedOffControllers.length &&
      justTurnedOffControllers.length === this.turnedOnControllers.length;
    justTurnedOffControllers.forEach(
      (c) => (this.turnedOnControllers = this.turnedOnControllers.filter((_c) => _c !== c.index))
    );
    if (allTurnedOff && this.config.enabled) {
      this.sleep.enableSleepMode({
        type: 'AUTOMATION',
        automation: 'SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF',
      });
    }
  }
}
