import { Component, DestroyRef, OnInit } from '@angular/core';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  WindowsPowerPolicyOnSleepModeAutomationConfig,
} from '../../../../../../models/automations';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';
import { WindowsPowerPolicy } from '../../../../../../models/windows-power-policy';

@Component({
  selector: 'app-windows-power-policy-tab',
  templateUrl: './windows-power-policy-tab.component.html',
  styleUrls: ['./windows-power-policy-tab.component.scss'],
})
export class WindowsPowerPolicyTabComponent implements OnInit {
  protected readonly policyOptions: SelectBoxItem[] = [
    {
      id: 'NONE',
      label: 'None',
    },
    {
      id: 'POWER_SAVING',
      label: 'Power Saving',
    },
    {
      id: 'BALANCED',
      label: 'Balanced',
    },
    {
      id: 'HIGH_PERFORMANCE',
      label: 'High Performance',
    },
  ];

  protected onSleepModeEnablePolicy: SelectBoxItem =
    this.policyOptions.find(
      (p) =>
        p.id === AUTOMATION_CONFIGS_DEFAULT.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE.powerPolicy
    ) ?? this.policyOptions[0];

  protected onSleepModeDisablePolicy: SelectBoxItem =
    this.policyOptions.find(
      (p) =>
        p.id === AUTOMATION_CONFIGS_DEFAULT.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE.powerPolicy
    ) ?? this.policyOptions[0];

  constructor(
    private router: Router,
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.onSleepModeEnablePolicy =
          this.policyOptions.find(
            (p) => p.id === configs.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE.powerPolicy
          ) ?? this.policyOptions[0];
        this.onSleepModeDisablePolicy =
          this.policyOptions.find(
            (p) => p.id === configs.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE.powerPolicy
          ) ?? this.policyOptions[0];
      });
  }

  async setPolicy(automation: 'ON_ENABLE' | 'ON_DISABLE', selectBoxItem: SelectBoxItem) {
    switch (automation) {
      case 'ON_ENABLE':
        await this.automationConfigService.updateAutomationConfig<WindowsPowerPolicyOnSleepModeAutomationConfig>(
          'WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE',
          {
            enabled: selectBoxItem.id !== 'NONE',
            powerPolicy:
              selectBoxItem.id === 'NONE' ? undefined : (selectBoxItem.id as WindowsPowerPolicy),
          }
        );
        break;
      case 'ON_DISABLE':
        await this.automationConfigService.updateAutomationConfig<WindowsPowerPolicyOnSleepModeAutomationConfig>(
          'WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE',
          {
            enabled: selectBoxItem.id !== 'NONE',
            powerPolicy:
              selectBoxItem.id === 'NONE' ? undefined : (selectBoxItem.id as WindowsPowerPolicy),
          }
        );
        break;
    }
  }
}
