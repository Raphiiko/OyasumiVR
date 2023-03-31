import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
import { BrightnessControlService } from './brightness-control/brightness-control.service';
import { EventLogService } from './event-log.service';
import { distinctUntilChanged, firstValueFrom, skip } from 'rxjs';
import { EventLogRenderResolutionChanged } from '../models/event-log-entry';
import { OpenVRService } from './openvr.service';

@Injectable({
  providedIn: 'root',
})
export class RenderResolutionAutomationService {
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
        ? c.RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE
        : c.RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE
    );
    if (!config.enabled) return;
    const openvrStatus = await firstValueFrom(this.openvr.status);
    if (openvrStatus !== 'INITIALIZED') return;
    await this.openvr.setSupersampleScale(config.resolution ? config.resolution / 100 : null);
    this.eventLog.logEvent({
      type: 'renderResolutionChanged',
      reason: sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED',
      resolution: config.resolution,
    } as EventLogRenderResolutionChanged);
  }
}
