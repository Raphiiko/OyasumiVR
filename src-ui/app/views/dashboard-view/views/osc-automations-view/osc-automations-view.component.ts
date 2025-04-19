import { Component, DestroyRef, OnInit } from '@angular/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  OscGeneralAutomationConfig,
} from '../../../../models/automations';

import { OpenVRService } from '../../../../services/openvr.service';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { OscScript } from '../../../../models/osc-script';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-osc-automations-view',
  templateUrl: './osc-automations-view.component.html',
  styleUrls: ['./osc-automations-view.component.scss'],
  standalone: false,
})
export class OscAutomationsViewComponent implements OnInit {
  protected config: OscGeneralAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.OSC_GENERAL
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
        this.config = configs.OSC_GENERAL;
      });
  }

  async setOscScript(
    event: 'onSleepModeEnable' | 'onSleepModeDisable' | 'onSleepPreparation',
    script: OscScript | undefined
  ) {
    await this.automationConfigService.updateAutomationConfig<OscGeneralAutomationConfig>(
      'OSC_GENERAL',
      { [event]: script }
    );
  }
}
