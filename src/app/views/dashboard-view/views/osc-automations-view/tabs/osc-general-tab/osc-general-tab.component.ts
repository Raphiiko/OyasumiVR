import { Component } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationType,
  OscGeneralAutomationConfig,
  RenderResolutionOnSleepModeAutomationConfig,
} from '../../../../../../models/automations';
import { cloneDeep } from 'lodash';
import { OpenVRService } from '../../../../../../services/openvr.service';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import { OscScript } from '../../../../../../models/osc-script';

@Component({
  selector: 'app-osc-general-tab',
  templateUrl: './osc-general-tab.component.html',
  styleUrls: ['./osc-general-tab.component.scss'],
})
export class OscGeneralTabComponent {
  private destroy$: Subject<void> = new Subject();
  protected config: OscGeneralAutomationConfig = cloneDeep(AUTOMATION_CONFIGS_DEFAULT.OSC_GENERAL);

  constructor(
    private openvr: OpenVRService,
    private automationConfigService: AutomationConfigService
  ) {}

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntil(this.destroy$))
      .subscribe(async (configs) => {
        this.config = configs.OSC_GENERAL;
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
  }

  async setOscScript(
    event: 'onSleepModeEnable' | 'onSleepModeDisable',
    script: OscScript | undefined
  ) {
    await this.automationConfigService.updateAutomationConfig<OscGeneralAutomationConfig>(
      'OSC_GENERAL',
      { [event]: script }
    );
  }
}
