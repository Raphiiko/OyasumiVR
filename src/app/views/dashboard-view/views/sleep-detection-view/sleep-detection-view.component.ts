import { Component, OnDestroy, OnInit } from '@angular/core';
import { fade, vshrink } from '../../../../utils/animations';
import { SimpleModalService } from 'ngx-simple-modal';
import { TimeEnableSleepModeModalComponent } from './time-enable-sleepmode-modal/time-enable-sleep-mode-modal.component';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { filter, Subject, takeUntil } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationConfigs,
  AutomationType,
  SleepModeDisableAtTimeAutomationConfig,
  SleepModeDisableOnDevicePowerOnAutomationConfig,
  SleepModeEnableAtBatteryPercentageAutomationConfig,
  SleepModeEnableAtTimeAutomationConfig,
} from '../../../../models/automations';
import { cloneDeep } from 'lodash';
import { TimeDisableSleepModeModalComponent } from './time-disable-sleepmode-modal/time-disable-sleep-mode-modal.component';
import { BatteryPercentageEnableSleepModeModalComponent } from './battery-percentage-enable-sleepmode-modal/battery-percentage-enable-sleep-mode-modal.component';
import { DevicePowerOnDisableSleepModeModalComponent } from './device-poweron-disable-sleepmode-modal/device-power-on-disable-sleep-mode-modal.component';

@Component({
  selector: 'app-sleep-detection-view',
  templateUrl: './sleep-detection-view.component.html',
  styleUrls: ['./sleep-detection-view.component.scss'],
  animations: [vshrink(), fade()],
})
export class SleepDetectionViewComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject<void>();
  automationConfigs: AutomationConfigs = cloneDeep(AUTOMATION_CONFIGS_DEFAULT);
  constructor(
    private modalService: SimpleModalService,
    private automationConfigService: AutomationConfigService
  ) {}

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntil(this.destroy$))
      .subscribe((configs) => (this.automationConfigs = configs));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
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
            triggerClasses: data.triggerClasses,
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

  toggleAutomation(automation: AutomationType) {
    this.automationConfigService.updateAutomationConfig(automation, {
      enabled: !this.automationConfigs[automation].enabled,
    });
  }
}
