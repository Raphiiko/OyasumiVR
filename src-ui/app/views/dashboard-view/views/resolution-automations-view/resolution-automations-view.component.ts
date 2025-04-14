import { Component, DestroyRef, OnInit } from '@angular/core';
import { OpenVRService } from '../../../../services/openvr.service';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationType,
  RenderResolutionOnSleepModeAutomationConfig,
} from '../../../../models/automations';

import { debounce } from 'typescript-debounce-decorator';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-resolution-automations-view',
    templateUrl: './resolution-automations-view.component.html',
    styleUrls: ['./resolution-automations-view.component.scss'],
    animations: [],
    standalone: false
})
export class ResolutionAutomationsViewComponent implements OnInit {
  protected onSleepModeEnableConfig: RenderResolutionOnSleepModeAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE
  );
  protected onSleepModeDisableConfig: RenderResolutionOnSleepModeAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE
  );

  constructor(
    private openvr: OpenVRService,
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.onSleepModeEnableConfig = configs.RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE;
        this.onSleepModeDisableConfig = configs.RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE;
      });
  }

  async setAutomationEnabled(automation: AutomationType, enabled: boolean) {
    await this.automationConfigService.updateAutomationConfig(automation, { enabled });
  }

  @debounce(250)
  async setRenderResolution(automation: AutomationType, resolution: number | null) {
    await this.automationConfigService.updateAutomationConfig<RenderResolutionOnSleepModeAutomationConfig>(
      automation,
      {
        resolution,
      }
    );
  }
}
