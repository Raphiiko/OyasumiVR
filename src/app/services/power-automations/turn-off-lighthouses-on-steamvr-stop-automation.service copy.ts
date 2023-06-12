import { Injectable } from '@angular/core';
import { cloneDeep } from 'lodash';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  TurnOffLighthousesOnSteamVRStopAutomationConfig,
} from 'src/app/models/automations';
import { AutomationConfigService } from '../automation-config.service';
import { LighthouseService } from '../lighthouse.service';
import { EventLogService } from '../event-log.service';
import {
  asyncScheduler,
  delay,
  filter,
  firstValueFrom,
  map,
  of,
  pairwise,
  skipUntil,
  throttleTime,
} from 'rxjs';
import { OpenVRService } from '../openvr.service';
import { EventLogLighthouseSetPowerState } from 'src/app/models/event-log-entry';
import { AppSettingsService } from '../app-settings.service';

@Injectable({
  providedIn: 'root',
})
export class TurnOffLighthousesOnSteamVRStopAutomationService {
  config: TurnOffLighthousesOnSteamVRStopAutomationConfig = cloneDeep(
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
        // Ignore status changes for the first 5 seconds
        skipUntil(of(null).pipe(delay(5000))),
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
          (d) => d.powerState === 'on'
        );
        if (devices.length) {
          this.eventLog.logEvent({
            type: 'lighthouseSetPowerState',
            reason: 'STEAMVR_STOP',
            devices: 'ALL',
            state: powerOffState,
          } as EventLogLighthouseSetPowerState);
        }
        devices.forEach((lighthouse) => this.lighthouse.setPowerState(lighthouse, powerOffState));
      });
  }
}
