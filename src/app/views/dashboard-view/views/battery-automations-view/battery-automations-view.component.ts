import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { noop } from '../../../../utils/animations';
import { Subject, takeUntil } from 'rxjs';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationType,
  TurnOffDevicesOnSleepModeEnableAutomationConfig,
  TurnOffDevicesWhenChargingAutomationConfig,
} from '../../../../models/automations';
import { cloneDeep } from 'lodash';
import { OVRDeviceClass } from '../../../../models/ovr-device';
import { Router } from '@angular/router';

@Component({
  selector: 'app-battery-automations-view',
  templateUrl: './battery-automations-view.component.html',
  styleUrls: ['./battery-automations-view.component.scss'],
  animations: [noop()],
})
export class BatteryAutomationsViewComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject();
  protected onSleepModeConfig: TurnOffDevicesOnSleepModeEnableAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE
  );
  protected onChargeConfig: TurnOffDevicesWhenChargingAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_WHEN_CHARGING
  );
  constructor(private router: Router, private automationConfigService: AutomationConfigService) {}

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent) {
    if ((event.target as HTMLElement).className !== 'sleepDetectionLink') return;
    event.preventDefault();
    this.router.navigate(['/dashboard/sleepDetection']);
  }

  ngOnInit(): void {
    this.automationConfigService.configs.pipe(takeUntil(this.destroy$)).subscribe((configs) => {
      this.onSleepModeConfig = configs.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE;
      this.onChargeConfig = configs.TURN_OFF_DEVICES_WHEN_CHARGING;
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
  }

  async toggleDeviceClass(automation: AutomationType, deviceClass: OVRDeviceClass) {
    let deviceClasses: OVRDeviceClass[] = [];
    switch (automation) {
      case 'TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE':
        deviceClasses = this.onSleepModeConfig.deviceClasses;
        break;
      case 'TURN_OFF_DEVICES_WHEN_CHARGING':
        deviceClasses = this.onChargeConfig.deviceClasses;
        break;
    }
    deviceClasses = deviceClasses.includes(deviceClass)
      ? deviceClasses.filter((dc) => dc !== deviceClass)
      : [...deviceClasses, deviceClass];
    await this.automationConfigService.updateAutomationConfig<
      TurnOffDevicesWhenChargingAutomationConfig | TurnOffDevicesOnSleepModeEnableAutomationConfig
    >(automation, {
      deviceClasses,
    });
  }
}
