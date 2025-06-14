import { Injectable } from '@angular/core';

import {
  AUTOMATION_CONFIGS_DEFAULT,
  TurnOffLighthousesOnSteamVRStopAutomationConfig,
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
  tap,
  throttleTime,
} from 'rxjs';
import { OpenVRService } from '../openvr.service';
import { EventLogLighthouseSetPowerState } from 'src-ui/app/models/event-log-entry';
import { AppSettingsService } from '../app-settings.service';
import { LighthouseDevice } from '../../models/lighthouse-device';

@Injectable({
  providedIn: 'root',
})
export class TurnOffLighthousesOnSteamVRStopAutomationService {
  config: TurnOffLighthousesOnSteamVRStopAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_LIGHTHOUSES_ON_STEAMVR_STOP
  );

  constructor(
    private automationConfig: AutomationConfigService,
    private lighthouse: LighthouseService,
    private openvr: OpenVRService,
    private eventLog: EventLogService,
    private appSettings: AppSettingsService
  ) {}

  async init() {
    // Get config
    this.automationConfig.configs
      .pipe(map((configs) => configs.TURN_OFF_LIGHTHOUSES_ON_STEAMVR_STOP))
      .subscribe((config) => (this.config = config));
    // Listen for SteamVR stop
    this.openvr.status
      .pipe(
        // Get the previous as and current status
        pairwise(),
        // Debounce so we don't accidentally turn off all the base stations
        debounceTime(5000),
        // Stop if it's not a SteamVR stop
        filter(([oldStatus, newStatus]) => oldStatus === 'INITIALIZED' && newStatus === 'INACTIVE'),
        // Stop if the automation is disabled
        filter(() => this.config.enabled),
        // Throttle these stops
        throttleTime(5000, asyncScheduler, { leading: true, trailing: false })
      )
      .subscribe(async () => {
        const powerOffState = await firstValueFrom(
          this.appSettings.settings.pipe(map((s) => s.lighthousePowerOffState))
        );
        const devices = (await firstValueFrom(this.lighthouse.devices)).filter(
          (d) => d.powerState === 'on' || d.powerState === 'unknown'
          // TODO: Filter only applicable devices
        );
        if (devices.length) {
          this.eventLog.logEvent({
            type: 'lighthouseSetPowerState',
            reason: 'STEAMVR_STOP',
            devices: 'ALL',
            state: powerOffState,
          } as EventLogLighthouseSetPowerState);
          devices.forEach((lighthouse) => this.lighthouse.setPowerState(lighthouse, powerOffState));
        }
      });
    // Listen for newly discovered lighthouses
    this.lighthouse.devices
      .pipe(
        debounceTime(2000),
        startWith([]),
        pairwise(),
        // Stop if the automation is disabled
        filter(() => this.config.enabled),
        // Get the newly discovered devices
        map(
          ([oldDevices, newDevices]) =>
            newDevices.filter((d) => !oldDevices.some((_d) => _d.id === d.id))
          // TODO: Filter only applicable devices
        ),
        // Handle the new devices
        tap((newDevices) => {
          newDevices.forEach((device) => this.handleNewDevice(device));
        })
      )
      .subscribe();
  }

  private async handleNewDevice(device: LighthouseDevice) {
    if (!this.config.enabled) return;
    if ((await firstValueFrom(this.openvr.status)) !== 'INACTIVE') return;
    switch (device.powerState) {
      case 'unknown':
      case 'on':
      case 'booting': {
        const offPowerState = await firstValueFrom(
          this.appSettings.settings.pipe(map((settings) => settings.lighthousePowerOffState))
        );
        await this.lighthouse.setPowerState(device, offPowerState);
        break;
      }
      case 'sleep':
      case 'standby':
      default:
        break;
    }
  }
}
