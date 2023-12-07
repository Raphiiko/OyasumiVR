import { Component, DestroyRef, HostListener, OnInit } from '@angular/core';
import { fade, vshrink } from '../../../../utils/animations';
import { ModalService } from 'src-ui/app/services/modal.service';
import { TimeEnableSleepModeModalComponent } from './time-enable-sleepmode-modal/time-enable-sleep-mode-modal.component';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { filter } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationConfigs,
  AutomationType,
  SleepModeDisableAfterTimeAutomationConfig,
  SleepModeDisableAtTimeAutomationConfig,
  SleepModeDisableOnDevicePowerOnAutomationConfig,
  SleepModeEnableAtBatteryPercentageAutomationConfig,
  SleepModeEnableAtTimeAutomationConfig,
  SleepModeEnableOnHeartRateCalmPeriodAutomationConfig,
} from '../../../../models/automations';
import { cloneDeep, uniq } from 'lodash';
import { TimeDisableSleepModeModalComponent } from './time-disable-sleepmode-modal/time-disable-sleep-mode-modal.component';
import { BatteryPercentageEnableSleepModeModalComponent } from './battery-percentage-enable-sleepmode-modal/battery-percentage-enable-sleep-mode-modal.component';
import { DevicePowerOnDisableSleepModeModalComponent } from './device-poweron-disable-sleepmode-modal/device-power-on-disable-sleep-mode-modal.component';
import { OVRDeviceClass } from '../../../../models/ovr-device';
import { TranslateService } from '@ngx-translate/core';
import { SleepDetectorEnableSleepModeModalComponent } from './sleep-detector-enable-sleepmode-modal/sleep-detector-enable-sleep-mode-modal.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { HeartRateCalmPeriodEnableSleepModeModalComponent } from './heart-rate-calm-period-enable-sleepmode-modal/heart-rate-calm-period-enable-sleep-mode-modal.component';
import { DurationDisableSleepModeModalComponent } from './duration-disable-sleepmode-modal/duration-disable-sleep-mode-modal.component';

@Component({
  selector: 'app-sleep-detection-view',
  templateUrl: './sleep-detection-view.component.html',
  styleUrls: ['./sleep-detection-view.component.scss'],
  animations: [vshrink(), fade()],
})
export class SleepDetectionViewComponent implements OnInit {
  automationConfigs: AutomationConfigs = cloneDeep(AUTOMATION_CONFIGS_DEFAULT);

  constructor(
    private modalService: ModalService,
    private automationConfigService: AutomationConfigService,
    private translate: TranslateService,
    private destroyRef: DestroyRef,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => (this.automationConfigs = configs));
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent) {
    if ((event.target as HTMLElement).className !== 'integrationsPageLink') return;
    event.preventDefault();
    this.router.navigate(['/dashboard/settings/integrations']);
  }

  openModal_EnableSleepModeAtTime() {
    this.modalService
      .addModal(TimeEnableSleepModeModalComponent, {
        time: this.automationConfigs.SLEEP_MODE_ENABLE_AT_TIME.time,
      })
      .pipe(filter((data) => !!data))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeEnableAtTimeAutomationConfig>(
          'SLEEP_MODE_ENABLE_AT_TIME',
          {
            time: data.time,
          }
        );
      });
  }

  openModal_DisableSleepModeAtTime() {
    this.modalService
      .addModal(TimeDisableSleepModeModalComponent, {
        time: this.automationConfigs.SLEEP_MODE_DISABLE_AT_TIME.time,
      })
      .pipe(filter((data) => !!data))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeDisableAtTimeAutomationConfig>(
          'SLEEP_MODE_DISABLE_AT_TIME',
          {
            time: data.time,
          }
        );
      });
  }

  openModal_DisableSleepModeAfterTime() {
    this.modalService
      .addModal(DurationDisableSleepModeModalComponent, {
        duration: this.automationConfigs.SLEEP_MODE_DISABLE_AFTER_TIME.duration,
      })
      .pipe(filter((data) => !!data))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeDisableAfterTimeAutomationConfig>(
          'SLEEP_MODE_DISABLE_AFTER_TIME',
          {
            duration: data.duration,
          }
        );
      });
  }

  openModal_EnableSleepModeAtBatteryPercentage() {
    this.modalService
      .addModal(BatteryPercentageEnableSleepModeModalComponent, {
        triggerClasses:
          this.automationConfigs.SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE.triggerClasses,
        threshold: this.automationConfigs.SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE.threshold,
      })
      .pipe(filter((data) => !!data))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeEnableAtBatteryPercentageAutomationConfig>(
          'SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE',
          {
            triggerClasses: uniq(data.triggerClasses),
            threshold: data.threshold,
          }
        );
      });
  }

  openModal_DisableSleepModeOnDevicePowerOn() {
    this.modalService
      .addModal(DevicePowerOnDisableSleepModeModalComponent, {
        triggerClasses: this.automationConfigs.SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON.triggerClasses,
      })
      .pipe(filter((data) => !!data))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeDisableOnDevicePowerOnAutomationConfig>(
          'SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON',
          {
            triggerClasses: data.triggerClasses,
          }
        );
      });
  }

  openModal_EnableSleepModeForSleepDetector() {
    this.modalService
      .addModal(SleepDetectorEnableSleepModeModalComponent, {})
      .pipe(filter((data) => !!data))
      .subscribe(() => {});
  }

  openModal_EnableSleepModeOnHeartRateCalmPeriod() {
    const config = this.automationConfigs.SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD;
    this.modalService
      .addModal(HeartRateCalmPeriodEnableSleepModeModalComponent, {
        threshold: config.heartRateThreshold,
        duration: config.periodDuration,
      })
      .pipe(filter((data) => !!data))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeEnableOnHeartRateCalmPeriodAutomationConfig>(
          'SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD',
          {
            heartRateThreshold: data.threshold,
            periodDuration: data.duration,
          }
        );
      });
  }

  toggleAutomation(automation: AutomationType, field = 'enabled') {
    this.automationConfigService.updateAutomationConfig(automation, {
      [field]: !((this.automationConfigs[automation] as any)[field] as any),
    } as any);
  }

  deviceClassesToString(classes: OVRDeviceClass[], tlkey_prefix: string): string {
    return classes.map((c) => this.translate.instant(tlkey_prefix + c)).join(', ');
  }

  async goToPowerAutomations(fragment: string) {
    await this.router.navigate(['dashboard', 'powerAutomations'], { fragment });
  }

  protected getStringForDuration(duration: string): string {
    return getStringForDuration(this.translate, duration);
  }
}

export function getStringForDuration(translate: TranslateService, duration: string): string {
  const [hours, minutes] = duration.split(':').map((v) => parseInt(v));
  if (hours && minutes) {
    return translate.instant(
      'sleep-detection.disableAutomations.afterTime.description.hoursAndMinutes',
      {
        hours,
        minutes,
      }
    );
  } else if (hours) {
    return translate.instant('sleep-detection.disableAutomations.afterTime.description.hours', {
      hours,
    });
  } else if (minutes) {
    return translate.instant('sleep-detection.disableAutomations.afterTime.description.minutes', {
      minutes,
    });
  } else {
    return '';
  }
}
