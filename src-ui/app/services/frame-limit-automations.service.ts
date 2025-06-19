import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
import { EventLogService } from './event-log.service';
import { FrameLimiterService } from './frame-limiter.service';
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  pairwise,
  skip,
} from 'rxjs';
import { OpenVRService } from './openvr.service';
import { FrameLimitConfigOption } from '../models/automations';
import { SleepPreparationService } from './sleep-preparation.service';
import { EventLogFrameLimitChanged } from '../models/event-log-entry';

@Injectable({
  providedIn: 'root',
})
export class FrameLimitAutomationsService {
  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private openvr: OpenVRService,
    private sleepPreparationService: SleepPreparationService,
    private eventLog: EventLogService,
    private frameLimiterService: FrameLimiterService
  ) {}

  async init() {
    this.sleepService.mode
      .pipe(skip(1), distinctUntilChanged())
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));

    // Run automations when the HMD gets connected
    this.openvr.devices
      .pipe(
        map((devices) => devices.find((d) => d.class === 'HMD')?.serialNumber ?? null),
        distinctUntilChanged(),
        pairwise(),
        filter(([prev, current]) => prev === null && current !== null),
        debounceTime(3000)
      )
      .subscribe(() => this.onHmdConnect());

    // Run automations when sleep preparation state changes
    this.sleepPreparationService.onSleepPreparation.subscribe(() => this.onSleepPreparation());
  }

  private async onSleepModeChange(sleepMode: boolean) {
    const configs = await firstValueFrom(this.automationConfigService.configs);
    const frameLimitConfig = configs.FRAME_LIMIT_AUTOMATIONS;
    const openvrStatus = await firstValueFrom(this.openvr.status);
    if (openvrStatus !== 'INITIALIZED') return;

    // Apply frame limits for each configured app
    for (const appConfig of frameLimitConfig.configs) {
      const frameLimitValue = sleepMode ? appConfig.onSleepEnable : appConfig.onSleepDisable;
      await this.applyFrameLimit(
        appConfig.appId,
        appConfig.appLabel,
        frameLimitValue,
        sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED'
      );
    }
  }

  private async onSleepPreparation() {
    const configs = await firstValueFrom(this.automationConfigService.configs);
    const frameLimitConfig = configs.FRAME_LIMIT_AUTOMATIONS;
    const openvrStatus = await firstValueFrom(this.openvr.status);
    if (openvrStatus !== 'INITIALIZED') return;

    // Apply frame limits for preparation state
    for (const appConfig of frameLimitConfig.configs) {
      await this.applyFrameLimit(
        appConfig.appId,
        appConfig.appLabel,
        appConfig.onSleepPreparation,
        'SLEEP_PREPARATION'
      );
    }
  }

  private async onHmdConnect() {
    // Apply current state when HMD connects
    const sleepMode = await firstValueFrom(this.sleepService.mode);
    const configs = await firstValueFrom(this.automationConfigService.configs);
    const frameLimitConfig = configs.FRAME_LIMIT_AUTOMATIONS;

    // Apply frame limits for HMD connection
    for (const appConfig of frameLimitConfig.configs) {
      const frameLimitValue = sleepMode ? appConfig.onSleepEnable : appConfig.onSleepDisable;
      await this.applyFrameLimit(appConfig.appId, appConfig.appLabel, frameLimitValue);
    }
  }

  private async applyFrameLimit(
    appId: number,
    appName: string,
    value: FrameLimitConfigOption,
    reason?: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION'
  ) {
    if (value === 'DISABLED') return;
    await this.frameLimiterService.setFrameLimitForAppId(appId, value);

    // Log the event - store either translation keys or percentage values
    let limitValue: string;
    switch (value) {
      case 'AUTO':
        limitValue = 'frame-limiter.selector.auto';
        break;
      case 0:
        limitValue = 'frame-limiter.selector.noLimit';
        break;
      default:
        // For numeric values, we use the percentage directly
        if (typeof value === 'number') {
          limitValue = Math.round((1 / (value + 1)) * 100) + '%';
        } else {
          limitValue = '';
        }
    }

    if (reason) {
      this.eventLog.logEvent({
        type: 'frameLimitChanged',
        appName,
        limit: limitValue,
        reason,
      } as EventLogFrameLimitChanged);
    }
  }
}
