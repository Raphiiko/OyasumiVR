import { Injectable } from '@angular/core';

import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { combineLatest, map } from 'rxjs';
import { AUTOMATION_CONFIGS_DEFAULT, DevicePowerAutomationsConfig } from '../../models/automations';
import { EventLogService } from '../event-log.service';
import { OVRDevice, OVRDeviceClass } from '../../models/ovr-device';
import { LighthouseConsoleService } from '../lighthouse-console.service';
import { SleepService } from '../sleep.service';
import { DeviceManagerService } from '../device-manager.service';

@Injectable({
  providedIn: 'root',
})
export class TurnOffDevicesOnBatteryLevelAutomationService {
  config: DevicePowerAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS
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
    private lighthouse: LighthouseConsoleService,
    private eventLog: EventLogService,
    private sleep: SleepService,
    private deviceManager: DeviceManagerService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.DEVICE_POWER_AUTOMATIONS))
      .subscribe((config) => (this.config = config));

    combineLatest([this.openvr.devices, this.sleep.mode]).subscribe(([devices, sleepMode]) => {
      for (const device of devices) {
        const previousLevel = this.batteryLevelCache[device.index]?.level || null;
        const currentLevel = device.battery;
        this.batteryLevelCache[device.index] = { level: currentLevel, class: device.class };
        if (!currentLevel || currentLevel === previousLevel || device.isCharging) return;
        this.processBatteryChange(device, previousLevel, currentLevel, sleepMode);
      }
    });
  }

  private async processBatteryChange(
    device: OVRDevice,
    previousLevel: number | null,
    currentLevel: number,
    sleepMode: boolean
  ) {
    // require a falling battery and an eligible sleep state
    if (previousLevel === null || previousLevel <= currentLevel) return;
    if (this.config.turnOffDevicesBelowBatteryLevel_onlyWhileAsleep && !sleepMode) return;
    // resolve whether this device is selected
    const devices = await this.deviceManager.getDevicesForSelection(
      this.config.turnOffDevicesBelowBatteryLevel
    );
    if (!devices.ovrDevices.find((d) => d.index === device.index)) return;
    if (currentLevel * 100 > this.config.turnOffDevicesBelowBatteryLevel_threshold) return;
    const threshold = this.config.turnOffDevicesBelowBatteryLevel_threshold;
    // record the result against the triggering battery threshold
    const dispatched = await this.lighthouse.turnOffDevices([device]);
    this.eventLog.logTurnedOffOpenVRDevices(dispatched, 'BATTERY_LEVEL', {
      batteryThreshold: threshold,
    });
  }
}
