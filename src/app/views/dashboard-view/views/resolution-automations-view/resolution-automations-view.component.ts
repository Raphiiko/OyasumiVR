import { Component, OnDestroy, OnInit } from '@angular/core';
import { OpenVRService } from '../../../../services/openvr.service';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { Subject, takeUntil } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationType,
  RenderResolutionOnSleepModeAutomationConfig,
} from '../../../../models/automations';
import { cloneDeep } from 'lodash';
import { debounce } from 'typescript-debounce-decorator';

@Component({
  selector: 'app-resolution-automations-view',
  templateUrl: './resolution-automations-view.component.html',
  styleUrls: ['./resolution-automations-view.component.scss'],
  animations: [],
})
export class ResolutionAutomationsViewComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject();
  protected onSleepModeEnableConfig: RenderResolutionOnSleepModeAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE
  );
  protected onSleepModeDisableConfig: RenderResolutionOnSleepModeAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE
  );

  constructor(
    private openvr: OpenVRService,
    private automationConfigService: AutomationConfigService
  ) {}

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntil(this.destroy$))
      .subscribe(async (configs) => {
        this.onSleepModeEnableConfig = configs.RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE;
        this.onSleepModeDisableConfig = configs.RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE;
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
  }

  async setAutomationEnabled(automation: AutomationType, enabled: boolean) {
    await this.automationConfigService.updateAutomationConfig(automation, { enabled });
  }

  @debounce(250)
  async setRenderResolution(automation: AutomationType, resolution: number | null) {
    console.log('setRenderResolution', automation, resolution);
    await this.automationConfigService.updateAutomationConfig<RenderResolutionOnSleepModeAutomationConfig>(
      automation,
      {
        resolution,
      }
    );
  }
}
