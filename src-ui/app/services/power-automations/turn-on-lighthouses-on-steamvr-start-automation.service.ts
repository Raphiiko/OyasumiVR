import { Injectable } from '@angular/core';

import {
  AUTOMATION_CONFIGS_DEFAULT,
  TurnOnLighthousesOnSteamVRStartAutomationConfig,
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
import { LighthouseDevice } from '../../models/lighthouse-device';

@Injectable({
  providedIn: 'root',
})
export class TurnOnLighthousesOnSteamVRStartAutomationService {
  config: TurnOnLighthousesOnSteamVRStartAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.TURN_ON_LIGHTHOUSES_ON_STEAMVR_START
  );

  constructor(
    private automationConfig: AutomationConfigService,
    private lighthouse: LighthouseService,
    private openvr: OpenVRService,
    private eventLog: EventLogService
  ) {}

  async init() {
    // Get config
    this.automationConfig.configs
      .pipe(map((configs) => configs.TURN_ON_LIGHTHOUSES_ON_STEAMVR_START))
      .subscribe((config) => (this.config = config));
    // Listen for SteamVR start
    this.openvr.status
      .pipe(
        // Get the previous as and current status
        pairwise(),
        // Stop if it's not a SteamVR start
        filter(
          ([oldStatus, newStatus]) => oldStatus === 'INITIALIZING' && newStatus === 'INITIALIZED'
        ),
        // Stop if the automation is disabled
        filter(() => this.config.enabled),
        // Throttle these starts
        throttleTime(5000, asyncScheduler, { leading: true, trailing: false })
      )
      .subscribe(async () => {
        const devices = (await firstValueFrom(this.lighthouse.devices)).filter(
          (d) =>
            (d.powerState === 'sleep' ||
              d.powerState === 'standby' ||
              d.powerState === 'booting' ||
              d.powerState === 'unknown') &&
            !this.lighthouse.isDeviceIgnored(d)
        );
        if (devices.length) {
          this.eventLog.logEvent({
            type: 'lighthouseSetPowerState',
            reason: 'STEAMVR_START',
            devices: 'ALL',
            state: 'on',
          } as EventLogLighthouseSetPowerState);
        }
        devices.forEach((lighthouse) => this.lighthouse.setPowerState(lighthouse, 'on'));
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
        map(([oldDevices, newDevices]) =>
          newDevices
            .filter((d) => !oldDevices.some((_d) => _d.id === d.id))
            .filter((d) => !this.lighthouse.isDeviceIgnored(d))
        ),
        // Handle the new devices
        tap((newDevices) => {
          newDevices.forEach((device) => this.handleNewDevice(device));
        })
      )
      .subscribe();
  }

  private async handleNewDevice(device: LighthouseDevice, attempt = 0) {
    if (!this.config.enabled) return;
    if (!['INITIALIZED', 'INITIALIZING'].includes(await firstValueFrom(this.openvr.status))) return;
    switch (device.powerState) {
      case 'sleep':
      case 'standby': {
        await this.lighthouse.setPowerState(device, 'on');
        break;
      }
      case 'unknown': {
        // Attempt again in two seconds
        if (attempt < 5) {
          setTimeout(() => this.handleNewDevice(device, attempt + 1), 2000);
        }
        break;
      }
      case 'booting':
      case 'on':
      default:
        break;
    }
  }
}
