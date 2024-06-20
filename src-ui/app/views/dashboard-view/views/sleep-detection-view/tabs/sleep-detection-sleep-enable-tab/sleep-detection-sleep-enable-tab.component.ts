import { Component, HostListener, OnInit } from '@angular/core';
import { SleepDetectionTabComponent } from '../sleep-detection-tab.component';
import { TimeEnableSleepModeModalComponent } from '../../modals/time-enable-sleepmode-modal/time-enable-sleep-mode-modal.component';
import { filter } from 'rxjs';
import {
  SleepModeEnableAtBatteryPercentageAutomationConfig,
  SleepModeEnableAtTimeAutomationConfig,
  SleepModeEnableOnHeartRateCalmPeriodAutomationConfig,
} from '../../../../../../models/automations';
import { BatteryPercentageEnableSleepModeModalComponent } from '../../modals/battery-percentage-enable-sleepmode-modal/battery-percentage-enable-sleep-mode-modal.component';
import { uniq } from 'lodash';
import { HeartRateCalmPeriodEnableSleepModeModalComponent } from '../../modals/heart-rate-calm-period-enable-sleepmode-modal/heart-rate-calm-period-enable-sleep-mode-modal.component';
import { Router } from '@angular/router';

@Component({
  selector: 'app-sleep-detection-sleep-enable-tab',
  templateUrl: './sleep-detection-sleep-enable-tab.component.html',
  styleUrls: ['./sleep-detection-sleep-enable-tab.component.scss'],
})
export class SleepDetectionSleepEnableTabComponent
  extends SleepDetectionTabComponent
  implements OnInit
{
  constructor(private router: Router) {
    super();
  }

  ngOnInit() {
    super.ngOnInit();
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent) {
    if ((event.target as HTMLElement).className !== 'integrationsPageLink') return;
    event.preventDefault();
    this.router.navigate(['/dashboard/settings/integrations']);
  }

  async goToPowerAutomations(fragment: string) {
    await this.router.navigate(['dashboard', 'powerAutomations'], { fragment });
  }

  openModal_EnableSleepModeAtTime() {
    this.modalService
      .addModal(TimeEnableSleepModeModalComponent, {
        time: this.automationConfigs.SLEEP_MODE_ENABLE_AT_TIME.time,
      })
      .pipe(filter(Boolean))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeEnableAtTimeAutomationConfig>(
          'SLEEP_MODE_ENABLE_AT_TIME',
          {
            time: data.time,
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
      .pipe(filter(Boolean))
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

  openModal_EnableSleepModeOnHeartRateCalmPeriod() {
    const config = this.automationConfigs.SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD;
    this.modalService
      .addModal(HeartRateCalmPeriodEnableSleepModeModalComponent, {
        threshold: config.heartRateThreshold,
        duration: config.periodDuration,
      })
      .pipe(filter(Boolean))
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
}
