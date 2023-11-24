import { Component, DestroyRef, OnInit } from '@angular/core';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  WindowsPowerPolicyOnSleepModeAutomationConfig,
} from '../../../../../../models/automations';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';
import { WindowsService } from '../../../../../../services/windows.service';
import { combineLatest, tap } from 'rxjs';

@Component({
  selector: 'app-windows-power-policy-tab',
  templateUrl: './windows-power-policy-tab.component.html',
  styleUrls: ['./windows-power-policy-tab.component.scss'],
})
export class WindowsPowerPolicyTabComponent implements OnInit {
  protected policyOptions: SelectBoxItem[] = [
    {
      id: 'NONE',
      label: 'shared.common.none',
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
    private destroyRef: DestroyRef,
    private windowsService: WindowsService
  ) {}

  async ngOnInit() {
    combineLatest([
      this.automationConfigService.configs,
      // Update options when the windows power policies are updated
      this.windowsService.policies.pipe(
        tap((policies) => {
          this.policyOptions = [
            {
              id: 'NONE',
              label: 'shared.common.none',
            },
          ];
          policies.forEach((policy) => {
            this.policyOptions.push({
              id: policy.guid,
              label: policy.name,
            });
          });
        })
      ),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([configs, policies]) => {
        // Update options when the windows power policies are updated
        this.onSleepModeEnablePolicy =
          this.policyOptions.find(
            (p) => p.id === configs.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE.powerPolicy
          ) ?? this.policyOptions[0];
        this.onSleepModeDisablePolicy =
          this.policyOptions.find(
            (p) => p.id === configs.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE.powerPolicy
          ) ?? this.policyOptions[0];
      });
    // Fetch the current windows power policies when loading this view
    await this.windowsService.getWindowsPowerPolicies();
  }

  async setPolicy(automation: 'ON_ENABLE' | 'ON_DISABLE', selectBoxItem: SelectBoxItem) {
    switch (automation) {
      case 'ON_ENABLE':
        await this.automationConfigService.updateAutomationConfig<WindowsPowerPolicyOnSleepModeAutomationConfig>(
          'WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE',
          {
            enabled: selectBoxItem.id !== 'NONE',
            powerPolicy: selectBoxItem.id === 'NONE' ? undefined : selectBoxItem.id,
          }
        );
        break;
      case 'ON_DISABLE':
        await this.automationConfigService.updateAutomationConfig<WindowsPowerPolicyOnSleepModeAutomationConfig>(
          'WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE',
          {
            enabled: selectBoxItem.id !== 'NONE',
            powerPolicy: selectBoxItem.id === 'NONE' ? undefined : selectBoxItem.id,
          }
        );
        break;
    }
  }
}
