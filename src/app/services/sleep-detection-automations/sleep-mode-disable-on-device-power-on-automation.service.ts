import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeDisableOnDevicePowerOnAutomationConfig,
} from '../../models/automations';
import { cloneDeep } from 'lodash';
import { map } from 'rxjs';
import { SleepService } from '../sleep.service';

@Injectable({
  providedIn: 'root',
})
export class SleepModeDisableOnDevicePowerOnAutomationService {
  private config: SleepModeDisableOnDevicePowerOnAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON
  );
  private poweredOnDevices: number[] = [];
  private initialized = false;

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private sleep: SleepService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON))
      .subscribe((config) => (this.config = config));

    this.openvr.devices.subscribe((devices) => {
      // First initialization to compare against
      if (!this.initialized) {
        this.poweredOnDevices = devices
          .filter((d) => d.canPowerOff && !d.isTurningOff)
          .map((d) => d.index);
        this.initialized = true;
        return;
      }
      // Get current powered on devices
      const poweredOnDevices = devices.filter((d) => d.canPowerOff && !d.isTurningOff);
      // Remove devices that are no longer powered on
      this.poweredOnDevices = this.poweredOnDevices.filter(
        (dIndex) => !!poweredOnDevices.find((d) => d.index === dIndex)
      );
      // Get newly powered on devices
      const newPoweredOnDevices = poweredOnDevices.filter(
        (d) => !this.poweredOnDevices.includes(d.index)
      );
      // Add them to the powered on devices list
      this.poweredOnDevices.push(...newPoweredOnDevices.map((d) => d.index));
      // If none of the newly powered on devices should trigger this automation, stop here
      if (!newPoweredOnDevices.find((d) => this.config.triggerClasses.includes(d.class))) return;
      // Disable sleep mode if automation is enabled
      if (this.config.enabled) {
        this.sleep.disableSleepMode({
          type: 'AUTOMATION',
          automation: 'SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON',
        });
      }
    });
  }
}
