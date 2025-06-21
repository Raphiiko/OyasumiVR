import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, map, Subject } from 'rxjs';
import {
  AutoAcceptInviteRequestsAutomationConfig,
  AUTOMATION_CONFIGS_DEFAULT,
} from 'src-ui/app/models/automations';
import { AutomationConfigService } from 'src-ui/app/services/automation-config.service';
import { vshrink } from 'src-ui/app/utils/animations';

@Component({
  selector: 'app-invites-tab',
  templateUrl: './invites-tab.component.html',
  styleUrls: ['./invites-tab.component.scss'],
  standalone: false,
  animations: [vshrink()],
})
export class InvitesTabComponent implements OnInit {
  config: AutoAcceptInviteRequestsAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.AUTO_ACCEPT_INVITE_REQUESTS
  );
  protected updateDeclineInviteWhileAsleepCustomMessage = new Subject<string>();

  constructor(
    private automationConfig: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit() {
    this.automationConfig.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.config = structuredClone(configs.AUTO_ACCEPT_INVITE_REQUESTS);
      });
    this.updateDeclineInviteWhileAsleepCustomMessage
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        debounceTime(500),
        map((message) => message.trim().replace(/\s+/g, ' ').slice(0, 64)),
        distinctUntilChanged()
      )
      .subscribe((message) => {
        this.updateConfig({ declineInviteMessage: message });
      });
  }

  async updateConfig(config: Partial<AutoAcceptInviteRequestsAutomationConfig>) {
    await this.automationConfig.updateAutomationConfig('AUTO_ACCEPT_INVITE_REQUESTS', config);
  }
}
