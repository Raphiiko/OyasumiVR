import { Component, OnDestroy, OnInit } from '@angular/core';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import {
  AUTOMATION_DEFAULT_CONFIG,
  AutomationConfigs,
  AutomationType,
} from '../../../../../../models/automations';
import { Subject, takeUntil } from 'rxjs';
import { OVRDeviceClass } from '../../../../../../models/ovr-device';
import { cloneDeep } from 'lodash';
import { fade, vshrink } from '../../../../../../utils/animations';

@Component({
  selector: 'app-battery-settings',
  templateUrl: './battery-settings.component.html',
  styleUrls: ['./battery-settings.component.scss'],
  animations: [vshrink(), fade()],
})
export class BatterySettingsComponent implements OnInit, OnDestroy {
  destroy$: Subject<void> = new Subject<void>();
  configs: AutomationConfigs = AUTOMATION_DEFAULT_CONFIG;

  constructor(private automationConfig: AutomationConfigService) {}

  ngOnInit(): void {
    this.automationConfig.configs
      .pipe(takeUntil(this.destroy$))
      .subscribe((configs) => (this.configs = configs));
  }

  ngOnDestroy() {
    this.destroy$.next();
  }

  toggleAutomation(automation: AutomationType) {
    const currentConfig = this.configs[automation];
    const config = cloneDeep(currentConfig);
    config.enabled = !config.enabled;
    this.automationConfig.updateAutomationConfig(automation, config);
  }

  batteryPercentageAutomationToggleClass(
    category: 'TRIGGER' | 'POWER_OFF',
    deviceClass: OVRDeviceClass,
    enable: boolean
  ) {
    const config = cloneDeep(this.configs.BATTERY_PERCENTAGE);
    switch (category) {
      case 'TRIGGER':
        if (enable && !config.triggerClasses.includes(deviceClass)) {
          config.triggerClasses.push(deviceClass);
        } else if (!enable && config.triggerClasses.includes(deviceClass)) {
          config.triggerClasses = config.triggerClasses.filter((c) => c !== deviceClass);
        }
        break;
      case 'POWER_OFF':
        if (enable && !config.powerOffClasses.includes(deviceClass)) {
          config.powerOffClasses.push(deviceClass);
        } else if (!enable && config.powerOffClasses.includes(deviceClass)) {
          config.powerOffClasses = config.powerOffClasses.filter((c) => c !== deviceClass);
        }
        break;
    }
    this.automationConfig.updateAutomationConfig('BATTERY_PERCENTAGE', config);
  }

  batteryPercentageAutomationUpdateThreshold(el: HTMLInputElement) {
    const numberVal = parseInt(el.value);
    if (numberVal < 0 || numberVal > 100) {
      el.setCustomValidity('The percentage has to be between 0% and 100%');
      return;
    } else {
      el.setCustomValidity('');
    }
    const config = cloneDeep(this.configs.BATTERY_PERCENTAGE);
    config.threshold = numberVal;
    this.automationConfig.updateAutomationConfig('BATTERY_PERCENTAGE', config);
  }

  timeEventAutomationUpdateTime(timeEventTimeInput: HTMLInputElement) {
    const config = cloneDeep(this.configs.TIME_EVENT);
    config.time = timeEventTimeInput.value;
    this.automationConfig.updateAutomationConfig('TIME_EVENT', config);
  }

  timeEventAutomationToggleClass(deviceClass: OVRDeviceClass, enable: boolean) {
    const config = cloneDeep(this.configs.TIME_EVENT);
    if (enable && !config.powerOffClasses.includes(deviceClass)) {
      config.powerOffClasses.push(deviceClass);
    } else if (!enable && config.powerOffClasses.includes(deviceClass)) {
      config.powerOffClasses = config.powerOffClasses.filter((c) => c !== deviceClass);
    }
    this.automationConfig.updateAutomationConfig('TIME_EVENT', config);
  }

  chargingEventAutomationToggleClass(deviceClass: OVRDeviceClass, enable: boolean) {
    const config = cloneDeep(this.configs.CHARGING_EVENT);
    if (enable && !config.powerOffClasses.includes(deviceClass)) {
      config.powerOffClasses.push(deviceClass);
    } else if (!enable && config.powerOffClasses.includes(deviceClass)) {
      config.powerOffClasses = config.powerOffClasses.filter((c) => c !== deviceClass);
    }
    this.automationConfig.updateAutomationConfig('CHARGING_EVENT', config);
  }
}
