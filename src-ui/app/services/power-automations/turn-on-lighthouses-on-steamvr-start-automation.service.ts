import { Injectable } from '@angular/core';
import { cloneDeep } from 'lodash';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  TurnOnLighthousesOnSteamVRStartAutomationConfig,
} from 'src-ui/app/models/automations';
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
import { EventLogLighthouseSetPowerState } from 'src-ui/app/models/event-log-entry';

@Injectable({
  providedIn: 'root',
})
export class TurnOnLighthousesOnSteamVRStartAutomationService {
  config: TurnOnLighthousesOnSteamVRStartAutomationConfig = cloneDeep(
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
        // Ignore status changes for the first 5 seconds
        skipUntil(of(null).pipe(delay(5000))),
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
            d.powerState === 'sleep' || d.powerState === 'standby' || d.powerState === 'booting'
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
  }
}
