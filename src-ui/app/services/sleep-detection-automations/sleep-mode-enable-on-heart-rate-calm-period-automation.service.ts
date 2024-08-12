import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeEnableOnHeartRateCalmPeriodAutomationConfig,
} from '../../models/automations';

import { distinctUntilChanged, filter, firstValueFrom, map, skip } from 'rxjs';
import { SleepService } from '../sleep.service';
import { PulsoidService } from '../integrations/pulsoid.service';

@Injectable({
  providedIn: 'root',
})
export class SleepModeEnableOnHeartRateCalmPeriodAutomationService {
  private config: SleepModeEnableOnHeartRateCalmPeriodAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD
  );
  private thresholdLastExceeded = 0;
  private heartRateLastReceived = 0;
  private sleepModeLastDisabled = 0;

  constructor(
    private automationConfig: AutomationConfigService,
    private sleep: SleepService,
    private pulsoid: PulsoidService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD))
      .subscribe((config) => (this.config = config));
    this.sleep.mode
      .pipe(
        distinctUntilChanged(),
        skip(1),
        filter((sleepMode) => !sleepMode)
      )
      .subscribe(() => {
        this.sleepModeLastDisabled = Date.now();
      });
    this.pulsoid.heartRate.pipe(filter(Boolean)).subscribe(async (rate) => {
      const timeSinceLastReceived = Date.now() - this.heartRateLastReceived;
      this.heartRateLastReceived = Date.now();
      if (
        rate >= this.config.heartRateThreshold ||
        timeSinceLastReceived > 1000 * 20 // If the last data is too old we'll also cross the threshold, just to reset
      ) {
        this.thresholdLastExceeded = Date.now();
        return;
      }
      const timeSinceLastExceeded = Date.now() - this.thresholdLastExceeded;
      const timeSinceLastSleepDisabled = Date.now() - this.sleepModeLastDisabled;
      const sleepMode = await firstValueFrom(this.sleep.mode);
      if (
        this.config.enabled &&
        timeSinceLastExceeded >= this.config.periodDuration &&
        timeSinceLastSleepDisabled > 1000 * 60 * 15 && // Do not enable sleep mode if it was disabled less than 15 minutes ago
        !sleepMode
      ) {
        console.log({
          timeSinceLastExceeded,
          timeSinceLastReceived,
          timeSinceLastSleepDisabled,
          sleepMode,
        });
        this.thresholdLastExceeded = Date.now() + 1000 * 60 * 5; // Prevent from triggering again for 5 minutes
        await this.sleep.enableSleepMode({
          type: 'AUTOMATION',
          automation: 'SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD',
        });
      }
    });
  }
}
