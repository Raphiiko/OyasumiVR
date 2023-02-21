import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { listen } from '@tauri-apps/api/event';
import { OpenVRService } from '../openvr.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationType,
  SleepModeChangeOnSteamVRStatusAutomationConfig,
  SleepModeDisableAtTimeAutomationConfig,
  SleepModeEnableForSleepDetectorAutomationConfig,
} from '../../models/automations';
import { cloneDeep } from 'lodash';
import { debounceTime, filter, firstValueFrom, map, pairwise, tap } from 'rxjs';
import { SleepService } from '../sleep.service';
import { SleepModeStatusChangeReasonBase } from '../../models/sleep-mode';
import { SleepDetectorStateReport } from '../../models/events';

@Injectable({
  providedIn: 'root',
})
export class SleepModeForSleepDetectorAutomationService {
  private lastEnableAttempt = 0;
  private enableConfig: SleepModeEnableForSleepDetectorAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR
  );
  private distanceInLast10Seconds: number = -1;

  constructor(private automationConfig: AutomationConfigService, private sleep: SleepService) {}

  async init() {
    this.automationConfig.configs.subscribe(
      (configs) => (this.enableConfig = configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR)
    );
    await listen<SleepDetectorStateReport>('SLEEP_DETECTOR_STATE_REPORT', (event) =>
      this.handleStateReportForEnable(event.payload)
    );
  }

  async handleStateReportForEnable(report: SleepDetectorStateReport) {
    // Store the distance from the last 10 seconds for calibration purposes
    if (Date.now() - report.startTime > 1000 * 10)
      this.distanceInLast10Seconds = report.distanceInLast10Seconds;
    // Stop here if the automation is disabled
    if (!this.enableConfig.enabled) return;
    // Stop here if the sleep mode is already enabled
    if (await firstValueFrom(this.sleep.mode)) return;
    // Stop here if the last time we tried enabling was less than 5 minutes ago
    if (Date.now() - this.lastEnableAttempt < 1000 * 60 * 5) return;
    // Stop here if the sleep detection has been running for less than 15 minutes
    if (Date.now() - report.startTime < 1000 * 60 * 15) return;
    // Stop here if the positional movement was too high in the past 15 minutes
    if (report.distanceInLast15Minutes > this.enableConfig.calibrationValue * 150) return;
    // Attempt enabling sleep mode
    this.lastEnableAttempt = Date.now();
    await this.sleep.enableSleepMode({
      type: 'AUTOMATION',
      automation: 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
    });
  }

  async calibrate(): Promise<number> {
    if (this.distanceInLast10Seconds > 0) {
      await this.automationConfig.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
        'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
        {
          calibrationValue: this.distanceInLast10Seconds,
        }
      );
    }
    return this.distanceInLast10Seconds;
  }
}
