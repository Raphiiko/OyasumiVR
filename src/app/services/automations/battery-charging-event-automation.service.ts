import { Injectable } from '@angular/core';
import { AUTOMATION_DEFAULT_CONFIG, ChargingEventAutomationConfig } from '../../models/automations';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { map } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class BatteryChargingEventAutomationService {
  config: ChargingEventAutomationConfig = cloneDeep(AUTOMATION_DEFAULT_CONFIG.CHARGING_EVENT);
  chargingDevices: number[] = [];
  constructor(private automationConfig: AutomationConfigService, private openvr: OpenVRService) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.CHARGING_EVENT))
      .subscribe((config) => (this.config = config));

    this.openvr.devices.subscribe((devices) => {
      devices.forEach((device) => {
        if (device.isCharging && !this.chargingDevices.includes(device.index)) {
          this.chargingDevices.push(device.index);
          if (this.config.enabled && this.config.powerOffClasses.includes(device.class)) {
            this.openvr.turnOffDevices([device]);
          }
        } else if (!device.isCharging && this.chargingDevices.includes(device.index)) {
          this.chargingDevices = this.chargingDevices.filter((d) => d !== device.index);
        }
      });
    });
  }
}
