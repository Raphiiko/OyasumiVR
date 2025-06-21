import { Component, DestroyRef, OnInit } from '@angular/core';
import { distinctUntilChanged } from 'rxjs';
import { VRChatService } from '../../../../services/vrchat-api/vrchat.service';
import { hshrink, fade, vshrink } from '../../../../utils/animations';
import { isEqual } from 'lodash';
import {
  AutoAcceptInviteRequestsAutomationConfig,
  AUTOMATION_CONFIGS_DEFAULT,
} from '../../../../models/automations';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-invite-and-invite-request-view',
  templateUrl: './invite-and-invite-request-view.component.html',
  styleUrls: ['./invite-and-invite-request-view.component.scss'],
  animations: [fade(), vshrink(), hshrink()],
  standalone: false,
})
export class InviteAndInviteRequestViewComponent implements OnInit {
  activeTab: 'invite-requests' | 'invites' | 'sounds' = 'invite-requests';
  loggedIn = false;
  config: AutoAcceptInviteRequestsAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.AUTO_ACCEPT_INVITE_REQUESTS
  );
  isOnBusyStatus = false;
  isOnJoinMeStatus = false;
  playerIds: string[] = [];

  constructor(
    protected vrchat: VRChatService,
    private automationConfig: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.vrchat.status
      .pipe(takeUntilDestroyed(this.destroyRef), distinctUntilChanged())
      .subscribe(async (status) => {
        this.loggedIn = status === 'LOGGED_IN';
      });
    this.vrchat.user.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      this.isOnBusyStatus = user?.status === 'busy';
      this.isOnJoinMeStatus = user?.status === 'join me';
    });
    this.automationConfig.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.config = structuredClone(configs.AUTO_ACCEPT_INVITE_REQUESTS);
        const playersChanged = !isEqual(
          [...this.config.playerIds].sort(),
          [...this.playerIds].sort()
        );
        if (playersChanged) {
          this.playerIds = [...this.config.playerIds];
        }
      });
  }

  async updatePlayerIds(playerIds: string[]) {
    this.playerIds = playerIds;
    await this.automationConfig.updateAutomationConfig<AutoAcceptInviteRequestsAutomationConfig>(
      'AUTO_ACCEPT_INVITE_REQUESTS',
      { playerIds }
    );
  }
}
