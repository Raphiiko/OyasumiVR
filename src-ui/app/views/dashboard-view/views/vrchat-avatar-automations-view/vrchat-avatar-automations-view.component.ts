import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VRChatService } from '../../../../services/vrchat.service';
import { vshrink } from '../../../../utils/animations';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  VRChatAvatarAutomationsConfig,
} from '../../../../models/automations';
import { cloneDeep } from 'lodash';
import { PersistedAvatar } from '../../../../models/vrchat';

@Component({
  selector: 'app-vrchat-avatar-automations-view',
  templateUrl: './vrchat-avatar-automations-view.component.html',
  styleUrls: ['./vrchat-avatar-automations-view.component.scss'],
  animations: [vshrink()],
})
export class VRChatAvatarAutomationsViewComponent implements OnInit {
  loggedIn = false;
  config: VRChatAvatarAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.VRCHAT_AVATAR_AUTOMATIONS
  );

  constructor(
    private vrchat: VRChatService,
    private destroyRef: DestroyRef,
    private automationConfigService: AutomationConfigService
  ) {}

  ngOnInit(): void {
    this.vrchat.status.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.loggedIn = status === 'LOGGED_IN';
    });
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.config = configs.VRCHAT_AVATAR_AUTOMATIONS;
      });
  }

  login() {
    this.vrchat.showLoginModal();
  }

  async updateOnSleepEnable(avatar: PersistedAvatar | null) {
    await this.automationConfigService.updateAutomationConfig<VRChatAvatarAutomationsConfig>(
      'VRCHAT_AVATAR_AUTOMATIONS',
      {
        onSleepEnable: avatar,
      }
    );
  }

  async updateOnSleepDisable(avatar: PersistedAvatar | null) {
    await this.automationConfigService.updateAutomationConfig<VRChatAvatarAutomationsConfig>(
      'VRCHAT_AVATAR_AUTOMATIONS',
      {
        onSleepDisable: avatar,
      }
    );
  }

  async updateOnSleepPreparation(avatar: PersistedAvatar | null) {
    await this.automationConfigService.updateAutomationConfig<VRChatAvatarAutomationsConfig>(
      'VRCHAT_AVATAR_AUTOMATIONS',
      {
        onSleepPreparation: avatar,
      }
    );
  }
}
