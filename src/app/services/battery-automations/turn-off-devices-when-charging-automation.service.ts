import { Injectable } from '@angular/core';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { map } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  TurnOffDevicesWhenChargingAutomationConfig,
} from '../../models/automations';
import { LighthouseService } from '../lighthouse.service';
import { info } from 'tauri-plugin-log-api';

@Injectable({
  providedIn: 'root',
})
export class TurnOffDevicesWhenChargingAutomationService {
  config: TurnOffDevicesWhenChargingAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_WHEN_CHARGING
  );
  chargingDevices: number[] = [];
  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private lighthouse: LighthouseService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.TURN_OFF_DEVICES_WHEN_CHARGING))
      .subscribe((config) => (this.config = config));

    this.openvr.devices.subscribe((devices) => {
      devices.forEach((device) => {
        if (
          device.isCharging &&
          device.canPowerOff &&
          !this.chargingDevices.includes(device.index)
        ) {
          this.chargingDevices.push(device.index);
          if (this.config.enabled && this.config.deviceClasses.includes(device.class)) {
            info(
              `[TurnOffDevicesWhenChargingAutomationService] Detected device being put on charger. Turning off device (${device.class}:${device.serialNumber})`
            );
            this.lighthouse.turnOffDevices([device]);
          }
        } else if (!device.isCharging && this.chargingDevices.includes(device.index)) {
          this.chargingDevices = this.chargingDevices.filter((d) => d !== device.index);
        }
      });
    });
  }
}
