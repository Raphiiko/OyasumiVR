import { Component, HostBinding, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, triggerChildren, vshrink } from '../../../../../../utils/animations';
import { TranslateService } from '@ngx-translate/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  JoinNotificationsMode,
  SleepModeDisableOnPlayerJoinOrLeaveAutomationConfig,
} from '../../../../../../models/automations';

import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';

export interface PlayerJoinLeaveDisableSleepModeModalInputModel {
  config: SleepModeDisableOnPlayerJoinOrLeaveAutomationConfig;
}

export interface PlayerJoinLeaveDisableSleepModeModalOutputModel {
  config?: SleepModeDisableOnPlayerJoinOrLeaveAutomationConfig;
}

@Component({
  selector: 'app-player-join-leave-disable-sleepmode-modal',
  templateUrl: './player-join-leave-disable-sleep-mode-modal.component.html',
  styleUrls: ['./player-join-leave-disable-sleep-mode-modal.component.scss'],
  animations: [vshrink(), fadeUp(), fade(), triggerChildren()],
})
export class PlayerJoinLeaveDisableSleepModeModalComponent
  extends BaseModalComponent<
    PlayerJoinLeaveDisableSleepModeModalInputModel,
    PlayerJoinLeaveDisableSleepModeModalOutputModel
  >
  implements OnInit, PlayerJoinLeaveDisableSleepModeModalInputModel
{
  triggerOptions: SelectBoxItem[] = [
    {
      id: 'EVERYONE',
      label: 'sleep-detection.modals.disableForPlayerJoinLeave.triggerOptions.EVERYONE',
    },
    {
      id: 'FRIEND',
      label: 'sleep-detection.modals.disableForPlayerJoinLeave.triggerOptions.FRIEND',
    },
    {
      id: 'WHITELIST',
      label: 'sleep-detection.modals.disableForPlayerJoinLeave.triggerOptions.WHITELIST',
    },
    {
      id: 'BLACKLIST',
      label: 'sleep-detection.modals.disableForPlayerJoinLeave.triggerOptions.BLACKLIST',
    },
    {
      id: 'DISABLED',
      label: 'join-notifications.modeOptions.DISABLED',
    },
  ];
  joinTriggerOption: SelectBoxItem | undefined;
  leaveTriggerOption: SelectBoxItem | undefined;
  config: SleepModeDisableOnPlayerJoinOrLeaveAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE
  );

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  constructor(private translate: TranslateService) {
    super();
  }

  ngOnInit(): void {
    this.joinTriggerOption = this.triggerOptions.find(
      (option) => option.id === this.config?.joinMode
    );
    this.leaveTriggerOption = this.triggerOptions.find(
      (option) => option.id === this.config?.leaveMode
    );
  }

  save() {
    this.result = {
      config: this.config,
    };
    this.close();
  }

  asJoinNotificationsMode(id: string | undefined): JoinNotificationsMode | undefined {
    if (!id) return undefined;
    return id as JoinNotificationsMode;
  }

  setJoinTriggerOption(option: JoinNotificationsMode | undefined) {
    if (!option) return;
    this.config.joinMode = option;
  }

  setLeaveTriggerOption(option: JoinNotificationsMode | undefined) {
    if (!option) return;
    this.config.leaveMode = option;
  }
}
