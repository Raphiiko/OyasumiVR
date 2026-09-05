import { Injectable } from '@angular/core';

import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { map } from 'rxjs';
import { AUTOMATION_CONFIGS_DEFAULT, DevicePowerAutomationsConfig } from '../../models/automations';
import { LighthouseConsoleService } from '../lighthouse-console.service';
import { error, info } from '@tauri-apps/plugin-log';
import { EventLogTurnedOffOpenVRDevices } from '../../models/event-log-entry';
import { EventLogService } from '../event-log.service';
import { DeviceManagerService } from '../device-manager.service';
import { isEqual } from 'lodash';
import { OVRDevice } from '../../models/ovr-device';

@Injectable({
  providedIn: 'root',
})
export class TurnOffDevicesWhenChargingAutomationService {
  config: DevicePowerAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS
  );
  // retained object identity distinguishes separate charging sessions
  private chargingDevices: OVRDevice[] = [];

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private lighthouse: LighthouseConsoleService,
    private eventLog: EventLogService,
    private deviceManager: DeviceManagerService
  ) {}

  async init() {
    // keep power automation settings current as edits arrive
    this.automationConfig.configs
      .pipe(map((configs) => configs.DEVICE_POWER_AUTOMATIONS))
      .subscribe((config) => (this.config = config));

    // check each openvr device update for newly charging devices
    this.openvr.devices.subscribe((devices) => {
      // forget devices that disconnected or stopped charging
      this.chargingDevices = this.chargingDevices.filter((charging) =>
        devices.some((device) => device.serialNumber === charging.serialNumber && device.isCharging)
      );
      // handle unprocessed charging devices that support power-off
      devices.forEach(async (device) => {
        if (
          device.isCharging &&
          device.canPowerOff &&
          !this.chargingDevices.some((charging) => charging.serialNumber === device.serialNumber)
        ) {
          // mark this session before awaiting the selection lookup
          this.chargingDevices.push(device);

          // resolve the current settings into selected devices
          const selection = this.config.turnOffDevicesWhenCharging;
          let selected;
          try {
            selected = await this.deviceManager.getDevicesForSelection(selection);
          } catch (cause) {
            error(
              `[TurnOffDevicesWhenChargingAutomationService] Could not resolve selection: ${cause}`
            );
            return;
          }
          // recheck settings, charging session, and membership after awaiting
          if (
            !isEqual(selection, this.config.turnOffDevicesWhenCharging) ||
            !this.chargingDevices.includes(device) ||
            !selected.ovrDevices.some(
              (selectedDevice) => selectedDevice.serialNumber === device.serialNumber
            )
          )
            return;
          // record and request the power-off
          info(
            `[TurnOffDevicesWhenChargingAutomationService] Detected device being put on charger. Turning off device (${device.class}:${device.serialNumber})`
          );
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
          this.lighthouse.turnOffDevices([device]);
        }
      });
    });
  }
}
