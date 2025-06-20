import { Component, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  DevicePowerAutomationsConfig,
} from 'src-ui/app/models/automations';
import { DeviceSelection } from 'src-ui/app/models/device-manager';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { AutomationConfigService } from 'src-ui/app/services/automation-config.service';
import { LighthouseService, LighthouseStatus } from 'src-ui/app/services/lighthouse.service';

@Component({
  selector: 'app-devices-tab',
  templateUrl: './devices-tab.component.html',
  styleUrls: ['./devices-tab.component.scss'],
  standalone: false,
})
export class DevicesTabComponent {
  lighthouseStatus: LighthouseStatus = 'uninitialized';
  lighthousePowerControlDisabled = false;
  devicePowerAutomations: DevicePowerAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS
  );

  constructor(
    private lighthouse: LighthouseService,
    private appSettings: AppSettingsService,
    private destroyRef: DestroyRef,
    private automationConfigService: AutomationConfigService
  ) {}

  ngOnInit() {
    this.lighthouse.status.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.lighthouseStatus = status;
    });
    this.appSettings.settings.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((settings) => {
      this.lighthousePowerControlDisabled = !settings.lighthousePowerControl;
    });
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.devicePowerAutomations = configs.DEVICE_POWER_AUTOMATIONS;
      });
  }

  async updateDeviceSelection(
    automation: keyof DevicePowerAutomationsConfig,
    deviceSelection: DeviceSelection
  ) {
    await this.automationConfigService.updateAutomationConfig<DevicePowerAutomationsConfig>(
      'DEVICE_POWER_AUTOMATIONS',
      {
        [automation]: deviceSelection,
      }
    );
  }

  async updateBatteryLevelAutomationThreshold(threshold: number) {
    await this.automationConfigService.updateAutomationConfig<DevicePowerAutomationsConfig>(
      'DEVICE_POWER_AUTOMATIONS',
      {
        turnOffDevicesBelowBatteryLevel_threshold: threshold,
      }
    );
  }

  get hasBatteryLevelDeviceSelection(): boolean {
    return !!(
      this.devicePowerAutomations.turnOffDevicesBelowBatteryLevel.devices.length > 0 ||
      this.devicePowerAutomations.turnOffDevicesBelowBatteryLevel.types.length > 0 ||
      this.devicePowerAutomations.turnOffDevicesBelowBatteryLevel.tagIds.length > 0
    );
  }

  async updateBatteryLevelOnlyWhileAsleep(onlyWhileAsleep: boolean) {
    await this.automationConfigService.updateAutomationConfig<DevicePowerAutomationsConfig>(
      'DEVICE_POWER_AUTOMATIONS',
      {
        turnOffDevicesBelowBatteryLevel_onlyWhileAsleep: onlyWhileAsleep,
      }
    );
  }
}
