import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { listen } from '@tauri-apps/api/event';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeEnableForSleepDetectorAutomationConfig,
} from '../../models/automations';
import { cloneDeep } from 'lodash';
import { BehaviorSubject, distinctUntilChanged, firstValueFrom, Observable, skip } from 'rxjs';
import { SleepService } from '../sleep.service';
import { SleepDetectorStateReport } from '../../models/events';
import { NotificationService } from '../notification.service';
import { TranslateService } from '@ngx-translate/core';
import { EventLogService } from '../event-log.service';

@Injectable({
  providedIn: 'root',
})
export class SleepModeForSleepDetectorAutomationService {
  private sleepEnableTimeoutId: number | null = null;
  private lastEnableAttempt = 0;
  private lastSleepModeDisable = 0;
  private sleepCheckNotificationId: string | null = null;
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
    private translate: TranslateService,
    private eventLog: EventLogService
  ) {}

  async init() {
    this.automationConfig.configs.subscribe(
      (configs) => (this.enableConfig = configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR)
    );
    this.sleep.mode.pipe(distinctUntilChanged(), skip(1)).subscribe((mode) => {
      if (!mode) this.lastSleepModeDisable = Date.now();
    });
    new Promise((resolve) => setTimeout(resolve, 15000)).then(async () => {
      await listen<SleepDetectorStateReport>('SLEEP_DETECTOR_STATE_REPORT', (event) =>
        this.handleStateReportForEnable(event.payload)
      );
      await listen<{ gesture: string }>('GESTURE_DETECTED', async (event) => {
        if (event.payload.gesture !== 'head_shake') return;
        if (this.sleepEnableTimeoutId) {
          clearTimeout(this.sleepEnableTimeoutId);
          this.sleepEnableTimeoutId = null;
          this.eventLog.logEvent({
            type: 'sleepDetectorEnableCancelled',
          });
          await this.notifications.play_sound('bell');
          await this.notifications.send(
            this.translate.instant('notifications.sleepCheckCancel.content')
          );
          if (this.sleepCheckNotificationId) {
            await this.notifications.clearNotification(this.sleepCheckNotificationId);
            this.sleepCheckNotificationId = null;
          }
        }
      });
    });
  }

  async handleStateReportForEnable(report: SleepDetectorStateReport) {
    this._lastStateReport.next(report);
    // Stop here if the automation is disabled
    if (!this.enableConfig.enabled) return;
    // Stop here if the sleep mode is already enabled
    if (await firstValueFrom(this.sleep.mode)) return;
    // Stop here if the sleep detection has been running for less than the detection window
    if (Date.now() - report.startTime < 1000 * 60 * this.enableConfig.detectionWindowMinutes)
      return;
    // Stop here if the positional movement was too high in the past 15 minutes
    const threshold =
      this.enableConfig.calibrationValue * this.calibrationFactors[this.enableConfig.sensitivity];
    if (report.distanceInLast15Minutes > threshold) return;
    // Stop here if the last time we tried enabling was less than the detection window
    if (Date.now() - this.lastEnableAttempt < 1000 * 60 * this.enableConfig.detectionWindowMinutes)
      return;
    // Stop here if the last time we disabled sleep mode was less than the detection window
    if (
      Date.now() - this.lastSleepModeDisable <
      1000 * 60 * this.enableConfig.detectionWindowMinutes
    )
      return;
    // Attempt enabling sleep mode
    this.lastEnableAttempt = Date.now();
    // If necessary, first check if the user is asleep, allowing them to cancel.
    if (this.enableConfig.sleepCheck) {
      this.sleepCheckNotificationId = await this.notifications.send(
        this.translate.instant('notifications.sleepCheck.content'),
        8000
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

  getThresholdValues(): Array<{
    sensitivity: 'LOWEST' | 'LOW' | 'MEDIUM' | 'HIGH' | 'HIGHEST';
    threshold: number;
    active: boolean;
  }> {
    return Object.entries(this.calibrationFactors).map((entry) => ({
      sensitivity: entry[0] as 'LOWEST' | 'LOW' | 'MEDIUM' | 'HIGH' | 'HIGHEST',
      threshold: this.enableConfig.calibrationValue * entry[1],
      active: this.enableConfig.sensitivity === entry[0],
    }));
  }
}
