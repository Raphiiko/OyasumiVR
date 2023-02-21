import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { listen } from '@tauri-apps/api/event';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeEnableForSleepDetectorAutomationConfig,
} from '../../models/automations';
import { cloneDeep } from 'lodash';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { SleepService } from '../sleep.service';
import { SleepDetectorStateReport } from '../../models/events';

const CALIBRATION_FACTOR = 150;

@Injectable({
  providedIn: 'root',
})
export class SleepModeForSleepDetectorAutomationService {
  private lastEnableAttempt = 0;
  private enableConfig: SleepModeEnableForSleepDetectorAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR
  );
  private _lastStateReport: BehaviorSubject<SleepDetectorStateReport | null> =
    new BehaviorSubject<SleepDetectorStateReport | null>(null);

  public lastStateReport: Observable<SleepDetectorStateReport | null> =
    this._lastStateReport.asObservable();

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
    this._lastStateReport.next(report);
    // Stop here if the automation is disabled
    if (!this.enableConfig.enabled) return;
    // Stop here if the sleep mode is already enabled
    if (await firstValueFrom(this.sleep.mode)) return;
    // Stop here if the last time we tried enabling was less than 5 minutes ago
    if (Date.now() - this.lastEnableAttempt < 1000 * 60 * 5) return;
    // Stop here if the sleep detection has been running for less than 15 minutes
    if (Date.now() - report.startTime < 1000 * 60 * 15) return;
    // Stop here if the positional movement was too high in the past 15 minutes
    if (report.distanceInLast15Minutes > this.enableConfig.calibrationValue * CALIBRATION_FACTOR)
      return;
    // Attempt enabling sleep mode
    this.lastEnableAttempt = Date.now();
    await this.sleep.enableSleepMode({
      type: 'AUTOMATION',
      automation: 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
    });
  }

  async calibrate(): Promise<number> {
    let distanceInLast10Seconds = -1;
    if (this._lastStateReport.value) {
      if (Date.now() - this._lastStateReport.value.startTime > 1000 * 10) {
        distanceInLast10Seconds = this._lastStateReport.value.distanceInLast10Seconds;
      }
    }
    if (distanceInLast10Seconds > 0) {
      await this.automationConfig.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
        'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
        {
          calibrationValue: distanceInLast10Seconds,
        }
      );
    }
    return distanceInLast10Seconds;
  }
}
