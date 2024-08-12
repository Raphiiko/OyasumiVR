import { Component, DestroyRef, HostListener, OnInit } from '@angular/core';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationType,
  TurnOffDevicesOnBatteryLevelAutomationConfig,
  TurnOffDevicesOnSleepModeEnableAutomationConfig,
  TurnOffDevicesWhenChargingAutomationConfig,
} from '../../../../../../models/automations';

import { OVRDeviceClass } from '../../../../../../models/ovr-device';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { vshrink } from '../../../../../../utils/animations';

@Component({
  selector: 'app-controllers-and-trackers-tab',
  templateUrl: './controllers-and-trackers-tab.component.html',
  styleUrls: ['./controllers-and-trackers-tab.component.scss'],
  animations: [vshrink()],
})
export class ControllersAndTrackersTabComponent implements OnInit {
  protected onSleepModeConfig: TurnOffDevicesOnSleepModeEnableAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE
  );
  protected onChargeConfig: TurnOffDevicesWhenChargingAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_WHEN_CHARGING
  );
  protected onBatteryLevelConfig: TurnOffDevicesOnBatteryLevelAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_ON_BATTERY_LEVEL
  );
  protected activateSleepWhenControllersTurnedOff = false;

  constructor(
    private router: Router,
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {}

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent) {
    if ((event.target as HTMLElement).className !== 'sleepDetectionLink') return;
    event.preventDefault();
    this.router.navigate(['/dashboard/sleepDetection']);
  }

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.onSleepModeConfig = configs.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE;
        this.onChargeConfig = configs.TURN_OFF_DEVICES_WHEN_CHARGING;
        this.onBatteryLevelConfig = configs.TURN_OFF_DEVICES_ON_BATTERY_LEVEL;
        this.activateSleepWhenControllersTurnedOff =
          configs.SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF.enabled;
      });
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

  protected async changeOnBatteryLevelValue(devices: OVRDeviceClass, level: number) {
    switch (devices) {
      case 'Controller':
        await this.automationConfigService.updateAutomationConfig<TurnOffDevicesOnBatteryLevelAutomationConfig>(
          'TURN_OFF_DEVICES_ON_BATTERY_LEVEL',
          {
            turnOffControllersAtLevel: level,
          }
        );
        break;
      case 'GenericTracker':
        await this.automationConfigService.updateAutomationConfig<TurnOffDevicesOnBatteryLevelAutomationConfig>(
          'TURN_OFF_DEVICES_ON_BATTERY_LEVEL',
          {
            turnOffTrackersAtLevel: level,
          }
        );
        break;
    }
  }

  protected async toggleOnBatteryLevel(devices: OVRDeviceClass) {
    switch (devices) {
      case 'Controller':
        await this.automationConfigService.updateAutomationConfig<TurnOffDevicesOnBatteryLevelAutomationConfig>(
          'TURN_OFF_DEVICES_ON_BATTERY_LEVEL',
          {
            turnOffControllers: !this.onBatteryLevelConfig.turnOffControllers,
            turnOffControllersAtLevel: this.onBatteryLevelConfig.turnOffControllers
              ? AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_ON_BATTERY_LEVEL
                  .turnOffControllersAtLevel
              : this.onBatteryLevelConfig.turnOffControllersAtLevel,
          }
        );
        break;
      case 'GenericTracker':
        await this.automationConfigService.updateAutomationConfig<TurnOffDevicesOnBatteryLevelAutomationConfig>(
          'TURN_OFF_DEVICES_ON_BATTERY_LEVEL',
          {
            turnOffTrackers: !this.onBatteryLevelConfig.turnOffTrackers,
            turnOffTrackersAtLevel: this.onBatteryLevelConfig.turnOffTrackers
              ? AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_ON_BATTERY_LEVEL.turnOffTrackersAtLevel
              : this.onBatteryLevelConfig.turnOffTrackersAtLevel,
          }
        );
        break;
    }
  }

  protected async goToSleepDetection() {
    await this.router.navigate(['dashboard', 'sleepDetection']);
  }

  protected async toggleOnBatteryLevelOnlyDuringSleepMode(devices: OVRDeviceClass) {
    switch (devices) {
      case 'Controller':
        await this.automationConfigService.updateAutomationConfig<TurnOffDevicesOnBatteryLevelAutomationConfig>(
          'TURN_OFF_DEVICES_ON_BATTERY_LEVEL',
          {
            turnOffControllersOnlyDuringSleepMode:
              !this.onBatteryLevelConfig.turnOffControllersOnlyDuringSleepMode,
          }
        );
        break;
      case 'GenericTracker':
        await this.automationConfigService.updateAutomationConfig<TurnOffDevicesOnBatteryLevelAutomationConfig>(
          'TURN_OFF_DEVICES_ON_BATTERY_LEVEL',
          {
            turnOffTrackersOnlyDuringSleepMode:
              !this.onBatteryLevelConfig.turnOffTrackersOnlyDuringSleepMode,
          }
        );
        break;
    }
  }
}
