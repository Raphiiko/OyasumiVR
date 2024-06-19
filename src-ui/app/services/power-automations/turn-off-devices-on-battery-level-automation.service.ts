import { Injectable } from '@angular/core';

import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { combineLatest, map } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  TurnOffDevicesOnBatteryLevelAutomationConfig,
} from '../../models/automations';
import { EventLogService } from '../event-log.service';
import { OVRDevice, OVRDeviceClass } from '../../models/ovr-device';
import { LighthouseConsoleService } from '../lighthouse-console.service';
import { error } from 'tauri-plugin-log-api';
import { EventLogTurnedOffOpenVRDevices } from '../../models/event-log-entry';
import { SleepService } from '../sleep.service';

@Injectable({
  providedIn: 'root',
})
export class TurnOffDevicesOnBatteryLevelAutomationService {
  config: TurnOffDevicesOnBatteryLevelAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_ON_BATTERY_LEVEL
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
    private sleep: SleepService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.TURN_OFF_DEVICES_ON_BATTERY_LEVEL))
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
    if (!['Controller', 'GenericTracker'].includes(device.class)) return;
    let threshold = 0;
    switch (device.class) {
      case 'Controller':
        if (!this.config.turnOffControllers) return;
        if (this.config.turnOffControllersOnlyDuringSleepMode && !sleepMode) return;
        if (currentLevel > this.config.turnOffControllersAtLevel) return;
        threshold = this.config.turnOffControllersAtLevel;
        break;
      case 'GenericTracker':
        if (!this.config.turnOffTrackers) return;
        if (this.config.turnOffTrackersOnlyDuringSleepMode && !sleepMode) return;
        if (currentLevel > this.config.turnOffTrackersAtLevel) return;
        threshold = this.config.turnOffTrackersAtLevel;
        break;
      default:
        return;
    }
    await this.lighthouse.turnOffDevices([device]);
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
  }
}
