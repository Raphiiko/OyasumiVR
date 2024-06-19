import { Component, DestroyRef, OnInit } from '@angular/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  ChangeStatusGeneralEventsAutomationConfig,
} from '../../../../../../models/automations';

import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';
import { vrcStatusToString } from '../../../../../../utils/status-utils';
import { UserStatus } from 'vrchat';
import { DomSanitizer } from '@angular/platform-browser';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VRChatService } from '../../../../../../services/vrchat.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../../../components/confirm-modal/confirm-modal.component';
import { ModalService } from '../../../../../../services/modal.service';

@Component({
  selector: 'app-status-automations-general-tab',
  templateUrl: './status-automations-general-tab.component.html',
  styleUrls: ['./status-automations-general-tab.component.scss'],
})
export class StatusAutomationsGeneralTabComponent implements OnInit {
  UserStatus = UserStatus;
  loggedIn = false;
  config: ChangeStatusGeneralEventsAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_GENERAL_EVENTS
  );
  statusOptions: SelectBoxItem[] = [
    {
      id: 'join me',
      label: vrcStatusToString(UserStatus.JoinMe),
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: var(--color-vrchat-status-blue); font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
    {
      id: 'active',
      label: vrcStatusToString(UserStatus.Active),
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: var(--color-vrchat-status-green); font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
    {
      id: 'ask me',
      label: vrcStatusToString(UserStatus.AskMe),
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: var(--color-vrchat-status-orange); font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
    {
      id: 'busy',
      label: vrcStatusToString(UserStatus.Busy),
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: var(--color-vrchat-status-red); font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
  ];
  onSleepEnableStatusOption?: SelectBoxItem;
  onSleepDisableStatusOption?: SelectBoxItem;
  onSleepPreparationStatusOption?: SelectBoxItem;

  constructor(
    private sanitizer: DomSanitizer,
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef,
    private vrchat: VRChatService,
    private modalService: ModalService
  ) {}

  ngOnInit() {
    this.vrchat.status.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.loggedIn = status === 'LOGGED_IN';
    });
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.config = structuredClone(configs.CHANGE_STATUS_GENERAL_EVENTS);
        this.onSleepEnableStatusOption = this.statusOptions.find(
          (s) => s.id === this.config.statusOnSleepModeEnable
        );
        this.onSleepDisableStatusOption = this.statusOptions.find(
          (s) => s.id === this.config.statusOnSleepModeDisable
        );
        this.onSleepPreparationStatusOption = this.statusOptions.find(
          (s) => s.id === this.config.statusOnSleepPreparation
        );
      });
  }

  async updateConfig(config: Partial<ChangeStatusGeneralEventsAutomationConfig>) {
    await this.automationConfigService.updateAutomationConfig(
      'CHANGE_STATUS_GENERAL_EVENTS',
      config
    );
  }

  async setStatusOption(
    automation: 'ON_SLEEP_ENABLE' | 'ON_SLEEP_DISABLE' | 'ON_SLEEP_PREPARATION',
    option: SelectBoxItem | undefined
  ) {
    if (!option) return;
    switch (automation) {
      case 'ON_SLEEP_ENABLE':
        await this.updateConfig({
          statusOnSleepModeEnable: option.id! as UserStatus,
        });
        break;
      case 'ON_SLEEP_DISABLE':
        await this.updateConfig({
          statusOnSleepModeDisable: option.id! as UserStatus,
        });
        break;
      case 'ON_SLEEP_PREPARATION':
        await this.updateConfig({
          statusOnSleepPreparation: option.id! as UserStatus,
        });
        break;
    }
  }

  async updateStatusMessage(
    automation: 'ON_SLEEP_ENABLE' | 'ON_SLEEP_DISABLE' | 'ON_SLEEP_PREPARATION',
    value: string
  ) {
    value = value.trim().slice(0, 32);
    const key =
      automation === 'ON_SLEEP_ENABLE'
        ? 'statusMessageOnSleepModeEnable'
        : automation === 'ON_SLEEP_DISABLE'
        ? 'statusMessageOnSleepModeDisable'
        : 'statusMessageOnSleepPreparation';
    await this.updateConfig({
      [key]: value,
    });
  }

  login() {
    this.vrchat.showLoginModal();
  }

  showFAQ() {
    this.modalService
      .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
        title: 'Status Automations FAQ',
        message: 'status-automations.behaviourWarningFAQ',
        confirmButtonText: 'shared.modals.ok',
        showCancel: false,
      })
      .subscribe();
  }
}
