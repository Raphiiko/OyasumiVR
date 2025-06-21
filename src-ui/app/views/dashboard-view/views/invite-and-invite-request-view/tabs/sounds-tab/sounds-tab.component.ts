import { Component, DestroyRef, OnInit } from '@angular/core';
import { vshrink } from '../../../../../../utils/animations';
import {
  AutoAcceptInviteRequestsAutomationConfig,
  AUTOMATION_CONFIGS_DEFAULT,
} from '../../../../../../models/automations';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-sounds-tab',
  templateUrl: './sounds-tab.component.html',
  styleUrls: ['./sounds-tab.component.scss'],
  animations: [vshrink()],
  standalone: false,
})
export class SoundsTabComponent implements OnInit {
  config: AutoAcceptInviteRequestsAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.AUTO_ACCEPT_INVITE_REQUESTS
  );

  constructor(
    private automationConfig: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.automationConfig.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.config = structuredClone(configs.AUTO_ACCEPT_INVITE_REQUESTS);
      });
  }

  async updateConfig(config: Partial<AutoAcceptInviteRequestsAutomationConfig>) {
    await this.automationConfig.updateAutomationConfig('AUTO_ACCEPT_INVITE_REQUESTS', config);
  }
}
