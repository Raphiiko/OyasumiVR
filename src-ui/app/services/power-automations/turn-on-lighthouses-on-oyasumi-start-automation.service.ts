import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { LighthouseService } from '../lighthouse.service';
import { EventLogService } from '../event-log.service';
import {
  debounceTime,
  delay,
  distinctUntilChanged,
  firstValueFrom,
  map,
  of,
  takeUntil,
} from 'rxjs';
import { EventLogLighthouseSetPowerState } from 'src-ui/app/models/event-log-entry';
import { isEqual } from 'lodash';

@Injectable({
  providedIn: 'root',
})
export class TurnOnLighthousesOnOyasumiStartAutomationService {
  private seenDevices: string[] = [];

  constructor(
    private automationConfig: AutomationConfigService,
    private lighthouse: LighthouseService,
    private eventLog: EventLogService
  ) {}

  async init() {
    // Get the automation config
    const config = await firstValueFrom(
      this.automationConfig.configs.pipe(
        map((configs) => configs.TURN_ON_LIGHTHOUSES_ON_OYASUMI_START)
      )
    );
    // Stop if the automation is disabled
    if (!config.enabled) return;
    // Wait for 5 seconds (So that we can be sure most lighthouses will have been discovered already)
    await firstValueFrom(of(null).pipe(delay(5000)));
    // Turn on any lighthouse that is detected within the next 20 seconds
    this.lighthouse.devices
      .pipe(
        // Stop detection after 20 seconds
        takeUntil(of(null).pipe(delay(20000))),
        distinctUntilChanged((a, b) =>
          isEqual(
            a.map((d) => d.id),
            b.map((d) => d.id)
          )
        ),
        // Try to get most in one go
        debounceTime(500)
      )
      .subscribe((lighthouses) => {
        const devices = lighthouses.filter(
          (lighthouse) =>
            !this.lighthouse.isDeviceIgnored(lighthouse) &&
            !this.seenDevices.includes(lighthouse.id) &&
            (lighthouse.powerState === 'sleep' ||
              lighthouse.powerState === 'standby' ||
              lighthouse.powerState === 'booting')
        );
        lighthouses.forEach((d) => this.seenDevices.push(d.id));
        if (devices.length) {
          this.eventLog.logEvent({
            type: 'lighthouseSetPowerState',
            reason: 'OYASUMI_START',
            devices: 'ALL',
            state: 'on',
          } as EventLogLighthouseSetPowerState);
        }
        devices.forEach((lighthouse) => this.lighthouse.setPowerState(lighthouse, 'on'));
      });
  }
}
