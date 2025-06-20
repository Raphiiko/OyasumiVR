import { Injectable } from '@angular/core';

import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { combineLatest, distinctUntilChanged, map } from 'rxjs';
import { AUTOMATION_CONFIGS_DEFAULT, DevicePowerAutomationsConfig } from '../../models/automations';
import { LighthouseConsoleService } from '../lighthouse-console.service';
import { error, info } from '@tauri-apps/plugin-log';
import { EventLogTurnedOffOpenVRDevices } from '../../models/event-log-entry';
import { EventLogService } from '../event-log.service';
import { DeviceManagerService } from '../device-manager.service';
import { isEqual } from 'lodash';

@Injectable({
  providedIn: 'root',
})
export class TurnOffDevicesWhenChargingAutomationService {
  config: DevicePowerAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS
  );
  chargingDevices: number[] = [];
  applicableDevices: number[] = [];

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private lighthouse: LighthouseConsoleService,
    private eventLog: EventLogService,
    private deviceManager: DeviceManagerService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.DEVICE_POWER_AUTOMATIONS))
      .subscribe((config) => (this.config = config));

    combineLatest([
      this.openvr.devices.pipe(
        map((devices) => devices.map((d) => d.index)),
        distinctUntilChanged((a, b) => isEqual(a, b))
      ),
      this.deviceManager.knownDevices,
    ]).subscribe(async () => {
      const devices = await this.deviceManager.getDevicesForSelection(
        this.config.turnOffDevicesWhenCharging
      );
      this.applicableDevices = devices.ovrDevices.map((d) => d.index);
    });

    this.openvr.devices.subscribe(async (devices) => {
      devices.forEach(async (device) => {
        if (
          device.isCharging &&
          device.canPowerOff &&
          !this.chargingDevices.includes(device.index)
        ) {
          this.chargingDevices.push(device.index);
          if (!this.applicableDevices.includes(device.index)) return;
          info(
            `[TurnOffDevicesWhenChargingAutomationService] Detected device being put on charger. Turning off device (${device.class}:${device.serialNumber})`
          );
          this.lighthouse.turnOffDevices([device]);
          this.eventLog.logEvent({
            type: 'turnedOffOpenVRDevices',
            reason: 'CHARGING',
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
        } else if (!device.isCharging && this.chargingDevices.includes(device.index)) {
          this.chargingDevices = this.chargingDevices.filter((d) => d !== device.index);
        }
      });
    });
  }
}
