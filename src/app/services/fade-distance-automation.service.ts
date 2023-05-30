import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
import { EventLogService } from './event-log.service';
import { distinctUntilChanged, firstValueFrom, skip } from 'rxjs';
import { OpenVRService } from './openvr.service';
import { EventLogChaperoneFadeDistanceChanged } from '../models/event-log-entry';

@Injectable({
  providedIn: 'root',
})
export class ChaperoneFadeDistanceAutomationService {
  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private openvr: OpenVRService,
    private eventLog: EventLogService
  ) {}

  async init() {
    this.sleepService.mode
      .pipe(skip(1), distinctUntilChanged())
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
  }

  private async onSleepModeChange(sleepMode: boolean) {
    const config = await firstValueFrom(this.automationConfigService.configs).then((c) =>
      sleepMode
        ? c.CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_ENABLE
        : c.CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_DISABLE
    );
    if (!config.enabled) {
      return;
    }
    const openvrStatus = await firstValueFrom(this.openvr.status);
    if (openvrStatus !== 'INITIALIZED') {
      return;
    }
    await this.openvr.setFadeDistance(config.fadeDistance);
    this.eventLog.logEvent({
      type: 'chaperoneFadeDistanceChanged',
      reason: sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED',
      fadeDistance: config.fadeDistance,
    } as EventLogChaperoneFadeDistanceChanged);
  }
}
