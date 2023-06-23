import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { cloneDeep } from 'lodash';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationConfigs,
  AutomationType,
} from 'src-ui/app/models/automations';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { AutomationConfigService } from 'src-ui/app/services/automation-config.service';
import { LighthouseService, LighthouseStatus } from 'src-ui/app/services/lighthouse.service';
import { noop, vshrink } from 'src-ui/app/utils/animations';

@Component({
  selector: 'app-base-stations-tab',
  templateUrl: './base-stations-tab.component.html',
  styleUrls: ['./base-stations-tab.component.scss'],
  animations: [vshrink(), noop()],
})
export class BaseStationsTabComponent implements OnInit {
  automationConfigs: AutomationConfigs = cloneDeep(AUTOMATION_CONFIGS_DEFAULT);
  lighthouseStatus: LighthouseStatus = 'uninitialized';
  lighthousePowerControlDisabled = false;

  constructor(
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef,
    private lighthouse: LighthouseService,
    private appSettings: AppSettingsService
  ) {}

  ngOnInit() {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.automationConfigs = configs;
      });
    this.lighthouse.status.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.lighthouseStatus = status;
    });
    this.appSettings.settings.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((settings) => {
      this.lighthousePowerControlDisabled = !settings.lighthousePowerControl;
    });
  }

  async toggleAutomationEnabled(automation: AutomationType) {
    await this.automationConfigService.updateAutomationConfig(automation, {
      enabled: !this.automationConfigs[automation].enabled,
    });
  }

  async enableLighthouseControl() {
    await this.appSettings.updateSettings({ lighthousePowerControl: true });
  }
}
