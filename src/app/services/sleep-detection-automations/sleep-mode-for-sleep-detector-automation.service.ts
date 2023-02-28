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
import { NotificationService } from '../notification.service';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class SleepModeForSleepDetectorAutomationService {
  private sleepEnableTimeoutId: number | null = null;
  private lastEnableAttempt = 0;
  private enableConfig: SleepModeEnableForSleepDetectorAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR
  );
  private _lastStateReport: BehaviorSubject<SleepDetectorStateReport | null> =
    new BehaviorSubject<SleepDetectorStateReport | null>(null);

  public lastStateReport: Observable<SleepDetectorStateReport | null> =
    this._lastStateReport.asObservable();

  private calibrationFactors: { [key: string]: number } = {
    LOWEST: 100,
    LOW: 150,
    MEDIUM: 200,
    HIGH: 250,
    HIGHEST: 300,
  };

  constructor(
    private automationConfig: AutomationConfigService,
    private sleep: SleepService,
    private notifications: NotificationService,
    private translate: TranslateService
  ) {}

  async init() {
    this.automationConfig.configs.subscribe(
      (configs) => (this.enableConfig = configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR)
    );
    await listen<SleepDetectorStateReport>('SLEEP_DETECTOR_STATE_REPORT', (event) =>
      this.handleStateReportForEnable(event.payload)
    );
    await listen<{ gesture: string }>('GESTURE_DETECTED', async (event) => {
      if (event.payload.gesture !== 'head_shake') return;
      if (this.sleepEnableTimeoutId) {
        clearTimeout(this.sleepEnableTimeoutId);
        this.sleepEnableTimeoutId = null;
        await this.notifications.play_sound('bell');
        await this.notifications.send(
          this.translate.instant('notifications.sleepCheckCancel.title'),
          this.translate.instant('notifications.sleepCheckCancel.content')
        );
      }
    });
  }

  async handleStateReportForEnable(report: SleepDetectorStateReport) {
    this._lastStateReport.next(report);
    // Stop here if the automation is disabled
    if (!this.enableConfig.enabled) return;
    // Stop here if the sleep mode is already enabled
    if (await firstValueFrom(this.sleep.mode)) return;
    // Stop here if the sleep detection has been running for less than 15 minutes
    if (Date.now() - report.startTime < 1000 * 60 * 15) return;
    // Stop here if the positional movement was too high in the past 15 minutes
    if (
      report.distanceInLast15Minutes >
      this.enableConfig.calibrationValue * this.calibrationFactors[this.enableConfig.sensitivity]
    )
      return;
    // Stop here if the last time we tried enabling was less than 15 minutes ago
    if (Date.now() - this.lastEnableAttempt < 1000 * 60 * 1500) return;
    // Attempt enabling sleep mode
    this.lastEnableAttempt = Date.now();
    // If necessary, first check if the user is asleep, allowing them to cancel.
    if (this.enableConfig.sleepCheck) {
      await this.notifications.send(
        this.translate.instant('notifications.sleepCheck.title'),
        this.translate.instant('notifications.sleepCheck.content')
      );
      if (this.sleepEnableTimeoutId) return;
      this.sleepEnableTimeoutId = setTimeout(async () => {
        this.sleepEnableTimeoutId = null;
        await this.sleep.enableSleepMode({
          type: 'AUTOMATION',
          automation: 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
        });
      }, 20000) as unknown as number;
    }
    // Otherwise, just enable sleep mode straight away.
    else {
      await this.sleep.enableSleepMode({
        type: 'AUTOMATION',
        automation: 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      });
    }
  }

  async test() {}

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
