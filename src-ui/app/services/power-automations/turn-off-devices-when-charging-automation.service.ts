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
  /** When each connected device connected, and whether it reported charging then, by serial. */
  private connections = new Map<string, { at: number; charging: boolean }>();

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
        devices.some(
          (device) =>
            device.serialNumber === charging.serialNumber &&
            device.isCharging &&
            device.isConnected !== false
        )
      );
      // handle unprocessed charging devices that support power-off
      devices.forEach(async (device) => {
        if (
          device.isCharging &&
          device.canPowerOff &&
          device.isConnected !== false &&
          !this.chargingDevices.some((charging) => charging.serialNumber === device.serialNumber)
        ) {
          // mark this session before awaiting the selection lookup
          this.chargingDevices.push(device);

          // let a device that connected reporting charging report its real state first
          const connection = this.connections.get(device.serialNumber!);
          const settleMs = connection?.charging
            ? connection.at + RECONNECT_SETTLE_MS - Date.now()
            : 0;
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
    for (const serial of [...this.connections.keys()]) {
      if (!devices.some((device) => device.serialNumber === serial && device.isConnected))
        this.connections.delete(serial);
    }
    for (const device of devices) {
      if (!device.isConnected || !device.serialNumber) continue;
      const connection = this.connections.get(device.serialNumber);
      if (!connection) {
        this.connections.set(device.serialNumber, {
          at: Date.now(),
          charging: !!device.isCharging,
        });
      } else if (!device.isCharging) {
        // a later charging start is real once the device reported not charging
        connection.charging = false;
      }
    }
  }
}
