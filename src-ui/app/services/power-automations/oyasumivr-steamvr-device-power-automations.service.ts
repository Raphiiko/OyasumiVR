import { Injectable } from '@angular/core';

import {
  AUTOMATION_CONFIGS_DEFAULT,
  DevicePowerAutomationsConfig,
} from 'src-ui/app/models/automations';
import { AutomationConfigService } from '../automation-config.service';
import { LighthouseService } from '../lighthouse.service';
import { EventLogService } from '../event-log.service';
import {
  asyncScheduler,
  debounceTime,
  filter,
  firstValueFrom,
  map,
  pairwise,
  startWith,
  throttleTime,
} from 'rxjs';
import { OpenVRService } from '../openvr.service';
import { EventLogLighthouseSetPowerState } from 'src-ui/app/models/event-log-entry';
import { AppSettingsService } from '../app-settings.service';
import { LighthouseDevice } from '../../models/lighthouse-device';
import { DeviceManagerService } from '../device-manager.service';

@Injectable({
  providedIn: 'root',
})
export class OyasumiVRSteamVRDevicePowerAutomationsService {
  config: DevicePowerAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS
  );
  seenLighthouseIds = new Set<string>();

  constructor(
    private automationConfig: AutomationConfigService,
    private lighthouse: LighthouseService,
    private openvr: OpenVRService,
    private eventLog: EventLogService,
    private appSettings: AppSettingsService,
    private deviceManager: DeviceManagerService
  ) {}

  async init() {
    // Get config
    this.automationConfig.configs
      .pipe(map((configs) => configs.DEVICE_POWER_AUTOMATIONS))
      .subscribe((config) => (this.config = config));

    // Detect SteamVR stops
    this.openvr.status
      .pipe(
        pairwise(),
        debounceTime(1000),
        filter(([oldStatus, newStatus]) => oldStatus === 'INITIALIZED' && newStatus === 'INACTIVE'),
        throttleTime(5000, asyncScheduler, { leading: true, trailing: false })
      )
      .subscribe(() => {
        this.handleSteamVRStop();
      });

    // Detect SteamVR starts
    this.openvr.status
      .pipe(
        pairwise(),
        debounceTime(1000),
        filter(
          ([oldStatus, newStatus]) =>
            (oldStatus === 'INACTIVE' || oldStatus === 'INITIALIZING') &&
            newStatus === 'INITIALIZED'
        ),
        throttleTime(5000, asyncScheduler, { leading: true, trailing: false })
      )
      .subscribe(() => {
        this.handleSteamVRStart();
      });

    // Listen for newly discovered lighthouses
    this.lighthouse.devices
      .pipe(
        debounceTime(2000),
        startWith([]),
        // Only get devices for which the state is known
        map((devices) => devices.filter((d) => d.powerState !== 'unknown')),
        map((devices) => devices.filter((d) => !this.seenLighthouseIds.has(d.id)))
      )
      .subscribe((newDevices) => {
        newDevices.forEach((device) => this.handleNewLighthouseDevice(device));
      });
  }

  private async handleSteamVRStop() {
    const applicableDevices = await this.deviceManager.getDevicesForSelection(
      this.config.turnOffDevicesOnSteamVRStop
    );
    const applicableLighthouses = applicableDevices.lighthouseDevices.filter(
      (d) => d.powerState === 'on' || d.powerState === 'booting'
    );
    if (applicableLighthouses.length) {
      this.eventLog.logEvent({
        type: 'lighthouseSetPowerState',
        reason: 'STEAMVR_STOP',
        devices: applicableLighthouses.length > 1 ? 'VARIOUS' : 'SINGLE',
        state: this.appSettings.settingsSync.lighthousePowerOffState,
      } as EventLogLighthouseSetPowerState);
      await Promise.all(
        applicableLighthouses.map((lighthouse) =>
          this.lighthouse.setPowerState(
            lighthouse,
            this.appSettings.settingsSync.lighthousePowerOffState
          )
        )
      );
    }
  }

  private async handleSteamVRStart() {
    const applicableDevices = await this.deviceManager.getDevicesForSelection(
      this.config.turnOnDevicesOnSteamVRStart
    );
    const applicableLighthouses = applicableDevices.lighthouseDevices.filter(
      (d) => d.powerState === 'sleep' || d.powerState === 'standby'
    );
    if (applicableLighthouses.length) {
      this.eventLog.logEvent({
        type: 'lighthouseSetPowerState',
        reason: 'STEAMVR_START',
        devices: applicableLighthouses.length > 1 ? 'VARIOUS' : 'SINGLE',
        state: 'on',
      } as EventLogLighthouseSetPowerState);
      await Promise.all(
        applicableLighthouses.map((lighthouse) => this.lighthouse.setPowerState(lighthouse, 'on'))
      );
    }
  }

  // This handler turns newly discovered lighthouses on or off based on the SteamVR status, if they are configured to be affected.
  private async handleNewLighthouseDevice(device: LighthouseDevice) {
    this.seenLighthouseIds.add(device.id);
    let lighthouseStateChanged = false;

    // Handle SteamVR status based changesz
    const steamVRActive = (await firstValueFrom(this.openvr.status)) === 'INITIALIZED';
    if (steamVRActive) {
      const applicableDevices = this.deviceManager.getDevicesForSelection(
        this.config.turnOnDevicesOnSteamVRStart
      );
      const isLighthouseApplicable = (await applicableDevices).lighthouseDevices.some(
        (d) => d.id === device.id
      );
      const shouldPowerOn =
        isLighthouseApplicable &&
        (device.powerState === 'sleep' || device.powerState === 'standby');
      if (shouldPowerOn) {
        lighthouseStateChanged = true;
        this.eventLog.logEvent({
          type: 'lighthouseSetPowerState',
          reason: 'STEAMVR_START',
          devices: 'SINGLE',
          state: 'on',
        } as EventLogLighthouseSetPowerState);
        await this.lighthouse.setPowerState(device, 'on');
      }
    } else {
      const applicableDevices = this.deviceManager.getDevicesForSelection(
        this.config.turnOffDevicesOnSteamVRStop
      );
      const isLighthouseApplicable = (await applicableDevices).lighthouseDevices.some(
        (d) => d.id === device.id
      );
      const shouldPowerOff =
        isLighthouseApplicable && (device.powerState === 'on' || device.powerState === 'booting');
      if (shouldPowerOff) {
        lighthouseStateChanged = true;
        this.eventLog.logEvent({
          type: 'lighthouseSetPowerState',
          reason: 'STEAMVR_STOP',
          devices: 'SINGLE',
          state: this.appSettings.settingsSync.lighthousePowerOffState,
        } as EventLogLighthouseSetPowerState);
        await this.lighthouse.setPowerState(
          device,
          this.appSettings.settingsSync.lighthousePowerOffState
        );
      }
    }

    // If the lighthouse state was already changed, we don't need to do anything else.
    if (lighthouseStateChanged) return;

    const applicableDevices = await this.deviceManager.getDevicesForSelection(
      this.config.turnOnDevicesOnOyasumiStart
    );
    const isLighthouseApplicable = applicableDevices.lighthouseDevices.some(
      (d) => d.id === device.id
    );
    const shouldPowerOn =
      isLighthouseApplicable && (device.powerState === 'sleep' || device.powerState === 'standby');
    if (shouldPowerOn) {
      lighthouseStateChanged = true;
      this.eventLog.logEvent({
        type: 'lighthouseSetPowerState',
        reason: 'OYASUMI_START',
        devices: 'SINGLE',
        state: 'on',
      } as EventLogLighthouseSetPowerState);
      await this.lighthouse.setPowerState(device, 'on');
    }
  }
}
