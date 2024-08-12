import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { listen } from '@tauri-apps/api/event';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeEnableForSleepDetectorAutomationConfig,
} from '../../models/automations';

import {
  BehaviorSubject,
  distinctUntilChanged,
  firstValueFrom,
  map,
  Observable,
  pairwise,
  skip,
} from 'rxjs';
import { SleepService } from '../sleep.service';
import { SleepDetectorStateReport } from '../../models/events';
import { NotificationService } from '../notification.service';
import { TranslateService } from '@ngx-translate/core';
import { EventLogService } from '../event-log.service';
import { OpenVRInputService } from '../openvr-input.service';
import { OVRInputEventAction } from '../../models/ovr-input-event';
import { SleepingPose } from '../../models/sleeping-pose';
import { TelemetryService } from '../telemetry.service';

export type SleepDetectorStateReportHandlingResult =
  | 'AUTOMATION_DISABLED'
  | 'SLEEP_MODE_ALREADY_ENABLED'
  | 'NOT_IN_ACTIVATION_WINDOW'
  | 'NOT_RUNNING_LONG_ENOUGH'
  | 'TOO_MUCH_MOVEMENT'
  | 'RATE_LIMITED'
  | 'SLEEP_MODE_DISABLED_TOO_RECENTLY'
  | 'POSE_UPRIGHT_TOO_RECENTLY'
  | 'CONTROLLER_PRESENCE_INDICATED_TOO_RECENTLY'
  | 'SLEEP_CHECK_ALREADY_IN_PROGRESS'
  | 'SLEEP_CHECK'
  | 'SLEEP_CHECK_USER_AWAKE'
  | 'SLEEP_CHECK_USER_ASLEEP'
  | 'SLEEP_MODE_ENABLED';

@Injectable({
  providedIn: 'root',
})
export class SleepModeForSleepDetectorAutomationService {
  private sleepEnableTimeoutId: number | null = null;
  private lastEnableAttempt = 0;
  private lastSleepModeDisable = 0;
  private lastControllerButtonPresenceIndication = 0;
  private lastPose: SleepingPose = 'UNKNOWN';
  private lastUprightPose = 0;
  private sleepCheckNotificationId: string | null = null;
  private enableConfig: SleepModeEnableForSleepDetectorAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR
  );
  private _lastStateReport: BehaviorSubject<SleepDetectorStateReport | null> =
    new BehaviorSubject<SleepDetectorStateReport | null>(null);
  private _lastStateReportHandlingResult: BehaviorSubject<SleepDetectorStateReportHandlingResult | null> =
    new BehaviorSubject<SleepDetectorStateReportHandlingResult | null>(null);

  public lastStateReport: Observable<SleepDetectorStateReport | null> =
    this._lastStateReport.asObservable();
  public lastStateReportHandlingResult: Observable<SleepDetectorStateReportHandlingResult | null> =
    this._lastStateReportHandlingResult.asObservable();

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
    private eventLog: EventLogService,
    private openvrInputService: OpenVRInputService,
    private telemetry: TelemetryService
  ) {}

  async init() {
    this.automationConfig.configs.subscribe(
      (configs) => (this.enableConfig = configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR)
    );
    this.sleep.mode.pipe(distinctUntilChanged(), skip(1)).subscribe((mode) => {
      if (!mode) this.lastSleepModeDisable = Date.now();
    });
    this.sleep.pose.pipe(pairwise()).subscribe(([previous, current]) => {
      this.lastPose = current;
      if (current !== 'SIDE_FRONT' && previous === 'SIDE_FRONT') this.lastUprightPose = Date.now();
    });
    new Promise((resolve) => setTimeout(resolve, 15000)).then(async () => {
      await listen<SleepDetectorStateReport>('SLEEP_DETECTOR_STATE_REPORT', async (event) => {
        this._lastStateReport.next(event.payload);
        const result = await this.handleStateReportForEnable(event.payload);
        this._lastStateReportHandlingResult.next(result);
      });
      // Dismiss sleep check for head shake
      await listen<{ gesture: string }>('GESTURE_DETECTED', (event) => {
        if (event.payload.gesture !== 'head_shake') return;
        this.dismissSleepCheck();
      });
      // Detect controller button presence indication
      this.openvrInputService.state
        .pipe(
          map((s) => s[OVRInputEventAction.IndicatePresence]),
          pairwise(),
          map(([previous, current]) =>
            current.some(
              (currentDevice) =>
                !previous.some((previousDevice) => previousDevice.index === currentDevice.index)
            )
          )
        )
        .subscribe(() => {
          // Dismiss sleep check for controller button presence indication
          this.dismissSleepCheck();
          // Register last controller button presence indication time
          this.lastControllerButtonPresenceIndication = Date.now();
        });
    });
  }

  async dismissSleepCheck() {
    if (this.sleepEnableTimeoutId) {
      clearTimeout(this.sleepEnableTimeoutId);
      this.sleepEnableTimeoutId = null;
      this.eventLog.logEvent({
        type: 'sleepDetectorEnableCancelled',
      });
      this._lastStateReportHandlingResult.next('SLEEP_CHECK_USER_AWAKE');
      await this.notifications.playSound('notification_block');
      await this.notifications.send(
        this.translate.instant('notifications.sleepCheckCancel.content')
      );
      if (this.sleepCheckNotificationId) {
        await this.notifications.clearNotification(this.sleepCheckNotificationId);
        this.sleepCheckNotificationId = null;
      }
    }
  }

  async handleStateReportForEnable(
    report: SleepDetectorStateReport
  ): Promise<SleepDetectorStateReportHandlingResult> {
    // Stop here if the automation is disabled
    if (!this.enableConfig.enabled) return 'AUTOMATION_DISABLED';
    // Stop here if the sleep mode is already enabled
    if (await firstValueFrom(this.sleep.mode)) return 'SLEEP_MODE_ALREADY_ENABLED';
    // Stop here if we are not in the activation window
    if (
      this.enableConfig.activationWindow &&
      !this.isInActivationWindow(
        this.enableConfig.activationWindowStart,
        this.enableConfig.activationWindowEnd
      )
    )
      return 'NOT_IN_ACTIVATION_WINDOW';
    // Stop here if the sleep detection has been running for less than the detection window
    if (Date.now() - report.startTime < 1000 * 60 * this.enableConfig.detectionWindowMinutes)
      return 'NOT_RUNNING_LONG_ENOUGH';
    // Stop here if the positional movement was too high in the past 15 minutes
    const threshold =
      this.enableConfig.calibrationValue * this.calibrationFactors[this.enableConfig.sensitivity];
    if (report.distanceInLast15Minutes > threshold) return 'TOO_MUCH_MOVEMENT';
    // Stop here if the last time we tried enabling was less than the detection window
    if (Date.now() - this.lastEnableAttempt < 1000 * 60 * this.enableConfig.detectionWindowMinutes)
      return 'RATE_LIMITED';
    // Stop here if the last time we disabled sleep mode was less than the detection window
    if (
      Date.now() - this.lastSleepModeDisable <
      1000 * 60 * this.enableConfig.detectionWindowMinutes
    )
      return 'SLEEP_MODE_DISABLED_TOO_RECENTLY';
    // Stop here if the user has proven presence through controller buttons in the detection window
    if (
      this.enableConfig.considerControllerPresence &&
      Date.now() - this.lastControllerButtonPresenceIndication <
        1000 * 60 * this.enableConfig.detectionWindowMinutes
    )
      return 'CONTROLLER_PRESENCE_INDICATED_TOO_RECENTLY';
    // Stop here if the user has been upright within the detection window
    if (
      this.enableConfig.considerSleepingPose &&
      (this.lastPose === 'SIDE_FRONT' ||
        Date.now() - this.lastUprightPose < 1000 * 60 * this.enableConfig.detectionWindowMinutes)
    )
      return 'POSE_UPRIGHT_TOO_RECENTLY';
    // Attempt enabling sleep mode
    this.lastEnableAttempt = Date.now();
    // If necessary, first check if the user is asleep, allowing them to cancel.
    if (this.enableConfig.sleepCheck) {
      this.sleepCheckNotificationId = await this.notifications.send(
        this.translate.instant('notifications.sleepCheck.content'),
        8000
      );
      if (this.sleepEnableTimeoutId) return 'SLEEP_CHECK_ALREADY_IN_PROGRESS';
      this.sleepEnableTimeoutId = setTimeout(async () => {
        this.sleepEnableTimeoutId = null;
        this._lastStateReportHandlingResult.next('SLEEP_CHECK_USER_ASLEEP');
        await this.sleep.enableSleepMode({
          type: 'AUTOMATION',
          automation: 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
        });
        this._lastStateReportHandlingResult.next('SLEEP_MODE_ENABLED');
      }, 20000) as unknown as number;
      return 'SLEEP_CHECK';
    }
    // Otherwise, just enable sleep mode straight away.
    else {
      await this.sleep.enableSleepMode({
        type: 'AUTOMATION',
        automation: 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      });
      return 'SLEEP_MODE_ENABLED';
    }
  }

  public getThresholdValues(): Array<{
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

  public async calibrate(): Promise<number> {
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
      await this.telemetry.trackEvent('SLEEP_DETECTOR_CALIBRATED', {
        calibrationValue: distanceInLast10Seconds,
      });
    }
    return distanceInLast10Seconds;
  }

  private isInActivationWindow(
    start: [number, number],
    end: [number, number],
    now?: [number, number]
  ): boolean {
    if (!now) now = [new Date().getHours(), new Date().getMinutes()];
    const startMinutes = start[0] * 60 + start[1];
    const endMinutes = end[0] * 60 + end[1];
    const nowMinutes = now[0] * 60 + now[1];

    if (startMinutes < endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    }
    return nowMinutes <= endMinutes || nowMinutes >= startMinutes;
  }
}
