import { Injectable } from '@angular/core';

import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { combineLatest, map } from 'rxjs';
import { AUTOMATION_CONFIGS_DEFAULT, DevicePowerAutomationsConfig } from '../../models/automations';
import { EventLogService } from '../event-log.service';
import { OVRDevice, OVRDeviceClass } from '../../models/ovr-device';
import { LighthouseConsoleService } from '../lighthouse-console.service';
import { error } from '@tauri-apps/plugin-log';
import { EventLogTurnedOffOpenVRDevices } from '../../models/event-log-entry';
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
    if (previousLevel === null || previousLevel <= currentLevel) return;
    let threshold = 0;
    // Check if this automation is currently applicable based on the slepe mode
    if (this.config.turnOffDevicesBelowBatteryLevel_onlyWhileAsleep && !sleepMode) return;
    // Check if this automation applies to this device
    const devices = await this.deviceManager.getDevicesForSelection(
      this.config.turnOffDevicesBelowBatteryLevel
    );
    if (!devices.ovrDevices.find((d) => d.index === device.index)) return;
    // Check if the battery level is below the threshold
    if (currentLevel * 100 > this.config.turnOffDevicesBelowBatteryLevel_threshold) return;
    threshold = this.config.turnOffDevicesBelowBatteryLevel_threshold;
    // Log the event
    this.eventLog.logEvent({
      type: 'turnedOffOpenVRDevices',
      reason: 'BATTERY_LEVEL',
      batteryThreshold: threshold,
      devices: (() => {
        switch (device.class) {
          case 'Controller':
            return 'CONTROLLER';
          case 'GenericTracker':
            return 'TRACKER';
          default: {
            error(
              `[TurnOffDevicesWhenChargingAutomationService] Couldn't determine device class for event log entry (${device.class})`
            );
            return 'VARIOUS';
          }
        }
      })(),
    } as EventLogTurnedOffOpenVRDevices);
    // Turn off the device
    await this.lighthouse.turnOffDevices([device]);
  }
}
