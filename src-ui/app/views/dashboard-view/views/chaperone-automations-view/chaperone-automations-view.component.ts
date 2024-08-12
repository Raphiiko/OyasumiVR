import { Component, DestroyRef, OnInit } from '@angular/core';
import { OpenVRService } from '../../../../services/openvr.service';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationType,
  ChaperoneFadeDistanceOnSleepModeAutomationConfig,
} from '../../../../models/automations';

import { debounce } from 'typescript-debounce-decorator';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-chaperone-automations-view',
  templateUrl: './chaperone-automations-view.component.html',
  styleUrls: ['./chaperone-automations-view.component.scss'],
  animations: [],
})
export class ChaperoneAutomationsViewComponent implements OnInit {
  protected onSleepModeEnableConfig: ChaperoneFadeDistanceOnSleepModeAutomationConfig =
    structuredClone(AUTOMATION_CONFIGS_DEFAULT.CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_ENABLE);
  protected onSleepModeDisableConfig: ChaperoneFadeDistanceOnSleepModeAutomationConfig =
    structuredClone(AUTOMATION_CONFIGS_DEFAULT.CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_DISABLE);

  constructor(
    private openvr: OpenVRService,
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.onSleepModeEnableConfig = configs.CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_ENABLE;
        this.onSleepModeDisableConfig = configs.CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_DISABLE;
      });
  }

  async setAutomationEnabled(automation: AutomationType, enabled: boolean) {
    await this.automationConfigService.updateAutomationConfig(automation, { enabled });
  }

  @debounce(250)
  async setFadeDistance(automation: AutomationType, fadeDistance: number) {
    await this.automationConfigService.updateAutomationConfig<ChaperoneFadeDistanceOnSleepModeAutomationConfig>(
      automation,
      {
        fadeDistance,
      }
    );
  }
}
