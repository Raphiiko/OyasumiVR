import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import { PulsoidService } from './integrations/pulsoid.service';
import {
  asyncScheduler,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  switchMap,
  tap,
  throttleTime,
} from 'rxjs';
import { AutomationConfigService } from './automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  NightmareDetectionAutomationsConfig,
} from '../models/automations';

import { NotificationService } from './notification.service';
import { TranslateService } from '@ngx-translate/core';
import { NotificationSound } from '../models/notification-sounds.generated';

export const NIGHTMARE_DETECTION_NOTIFICATION_SOUND: NotificationSound = 'material_alarm_gentle';

@Injectable({
  providedIn: 'root',
})
export class NightmareDetectionAutomationService {
  private config: NightmareDetectionAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.NIGHTMARE_DETECTION
  );
  private sleepModeLastEnabled = Date.now();
  private heartRateAboveThreshold: boolean | null = null;
  private heartRateAboveThresholdLastChanged = Date.now();

  constructor(
    private sleepService: SleepService,
    private pulsoid: PulsoidService,
    private automationConfigService: AutomationConfigService,
    private notification: NotificationService,
    private translate: TranslateService
  ) {}

  async init() {
    this.automationConfigService.configs
      .pipe(map((configs) => configs.NIGHTMARE_DETECTION))
      .subscribe((config) => {
        this.config = config;
      });

    this.sleepService.mode
      .pipe(
        distinctUntilChanged(),
        tap((mode) => {
          if (mode) this.sleepModeLastEnabled = Date.now();
        })
      )
      .subscribe();

    this.pulsoid.heartRate
      .pipe(
        filter(Boolean),
        tap((rate) => {
          const aboveThreshold = rate >= this.config.heartRateThreshold;
          if (aboveThreshold !== this.heartRateAboveThreshold) {
            this.heartRateAboveThresholdLastChanged = Date.now();
            this.heartRateAboveThreshold = aboveThreshold;
          }
        }),
        switchMap(async () => {
          const timeSinceSleepModeEnabled = Date.now() - this.sleepModeLastEnabled;
          const timeSinceHeartRateAboveThresholdChanged =
            Date.now() - this.heartRateAboveThresholdLastChanged;
          const sleepModeEnabled = await firstValueFrom(this.sleepService.mode);

          const nightmareDetected =
            sleepModeEnabled &&
            this.heartRateAboveThreshold &&
            timeSinceSleepModeEnabled >= this.config.periodDuration &&
            timeSinceHeartRateAboveThresholdChanged >= this.config.periodDuration;

          return nightmareDetected;
        }),
        distinctUntilChanged(),
        filter(Boolean),
        // Only trigger every half an hour at most
        throttleTime(1000 * 60 * 30, asyncScheduler, { leading: true, trailing: false })
      )
      .subscribe(() => this.detectNightmare());
  }

  private async detectNightmare() {
    if (this.config.disableSleepMode || this.config.playSound) {
      await this.notification.send(this.translate.instant('nightmare-detection.notification'));
    }
    if (this.config.disableSleepMode) {
      await this.sleepService.disableSleepMode({
        type: 'AUTOMATION',
        automation: 'NIGHTMARE_DETECTION',
      });
    }
    if (this.config.playSound) {
      await this.notification.playSound(
        NIGHTMARE_DETECTION_NOTIFICATION_SOUND,
        this.config.soundVolume / 100
      );
    }
  }
}
