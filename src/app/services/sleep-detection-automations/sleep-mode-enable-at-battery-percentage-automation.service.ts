import { Injectable } from '@angular/core';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { map } from 'rxjs';
import { OVRDevice, OVRDeviceClass } from '../../models/ovr-device';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeEnableAtBatteryPercentageAutomationConfig,
} from '../../models/automations';
import { SleepService } from '../sleep.service';

@Injectable({
  providedIn: 'root',
})
export class SleepModeEnableAtBatteryPercentageAutomationService {
  private config: SleepModeEnableAtBatteryPercentageAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE
  );
  private batteryLevelCache: {
    [deviceIndex: number]: {
      class: OVRDeviceClass;
      level: number;
    };
  } = {};

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private sleep: SleepService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE))
      .subscribe((config) => (this.config = config));

    this.openvr.devices.subscribe((devices) => {
      for (let device of devices) {
        const previousLevel = this.batteryLevelCache[device.index]?.level || null;
        const currentLevel = device.battery;
        if (!currentLevel || currentLevel === previousLevel || device.isCharging) return;
        this.batteryLevelCache[device.index] = { level: currentLevel, class: device.class };
        this.processBatteryChange(devices, device, previousLevel, currentLevel);
      }
    });
  }

  private async processBatteryChange(
    devices: OVRDevice[],
    device: OVRDevice,
    previousLevel: number | null,
    currentLevel: number
  ) {
    // Stop if automation is not enabled
    // Stop if we don't trigger on this class of device
    // Stop if the device is charging
    if (
      !this.config.enabled ||
      !this.config.triggerClasses.includes(device.class) ||
      device.isCharging
    )
      return;
    // Stop if the level does not transition over the threshold
    const threshold = this.config.threshold / 100;
    if (previousLevel === null || previousLevel <= threshold || currentLevel > threshold) return;
    // Stop if there are other triggering devices that already met the threshold
    if (
      devices
        .filter((d) => d.index !== device.index) // Is not the current device
        .filter((d) => this.config.triggerClasses.includes(d.class) && d.canPowerOff) // Can trigger
        .find((d) => !d.isCharging && d.battery && d.battery <= threshold) // Already meets the threshold
    )
      return;
    // Enable sleep mode
    this.sleep.enableSleepMode({
      type: 'AUTOMATION',
      automation: 'SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE',
    });
  }
}
