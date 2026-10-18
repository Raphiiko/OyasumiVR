import { Injectable } from '@angular/core';

import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { map } from 'rxjs';
import { AUTOMATION_CONFIGS_DEFAULT, DevicePowerAutomationsConfig } from '../../models/automations';
import { LighthouseConsoleService } from '../lighthouse-console.service';
import { error, info } from '@tauri-apps/plugin-log';
import { EventLogService } from '../event-log.service';
import { DeviceManagerService } from '../device-manager.service';
import { isEqual } from 'lodash';
import { OVRDevice } from '../../models/ovr-device';
import { sleep } from '../../utils/promise-utils';

// SteamVR still reports a controller's old charging state for a moment after it reconnects
const RECONNECT_SETTLE_MS = 10000;

@Injectable({
  providedIn: 'root',
})
export class TurnOffDevicesWhenChargingAutomationService {
  config: DevicePowerAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS
  );
  // retained object identity distinguishes separate charging sessions
  private chargingDevices: OVRDevice[] = [];
  /** When each connected device was first seen connected, by serial number. */
  private connectedSince = new Map<string, number>();

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
      this.trackConnections(devices);

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

          // let a device that just connected report its real charging state first
          const connectedAt = this.connectedSince.get(device.serialNumber!) ?? 0;
          const settleMs = connectedAt + RECONNECT_SETTLE_MS - Date.now();
          if (settleMs > 0) await sleep(settleMs);

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
          // request power-off and record only successful commands
          info(
            `[TurnOffDevicesWhenChargingAutomationService] Detected device being put on charger. Turning off device (${device.class}:${device.serialNumber})`
          );
          const dispatched = await this.lighthouse.turnOffDevices([device]);
          this.eventLog.logTurnedOffOpenVRDevices(dispatched, 'CHARGING');
        }
      });
    });
  }

  private trackConnections(devices: OVRDevice[]) {
    for (const serial of [...this.connectedSince.keys()]) {
      if (!devices.some((device) => device.serialNumber === serial && device.isConnected))
        this.connectedSince.delete(serial);
    }
    for (const device of devices) {
      if (
        device.isConnected &&
        device.serialNumber &&
        !this.connectedSince.has(device.serialNumber)
      )
        this.connectedSince.set(device.serialNumber, Date.now());
    }
  }
}
