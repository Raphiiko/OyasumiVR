import { Component, DestroyRef, OnInit } from '@angular/core';
import { hshrink, noop, vshrink } from '../../../../utils/animations';
import { VRChatService } from '../../../../services/vrchat.service';
import { BehaviorSubject, debounceTime, distinctUntilChanged, filter, switchMap, tap } from 'rxjs';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { DomSanitizer } from '@angular/platform-browser';
import { UserStatus } from 'vrchat/dist';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  ChangeStatusBasedOnPlayerCountAutomationConfig,
} from '../../../../models/automations';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../components/confirm-modal/confirm-modal.component';
import { clamp } from '../../../../utils/number-utils';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalService } from 'src-ui/app/services/modal.service';
import { vrcStatusToString } from '../../../../utils/status-utils';

@Component({
  selector: 'app-status-automations-view',
  templateUrl: './status-automations-view.component.html',
  styleUrls: ['./status-automations-view.component.scss'],
  animations: [vshrink(), noop(), hshrink()],
})
export class StatusAutomationsViewComponent implements OnInit {
  UserStatus = UserStatus;
  loggedIn = false;
  limit: BehaviorSubject<number> = new BehaviorSubject<number>(1);
  bedLimit = 1;
  config: ChangeStatusBasedOnPlayerCountAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_BASED_ON_PLAYER_COUNT
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
  optionSetStatusAtLimitOrAbove: SelectBoxItem = this.statusOptions.find(
    (o) => o.id === this.config.statusAtLimitOrAbove
  )!;
  optionSetStatusBelowLimit: SelectBoxItem = this.statusOptions.find(
    (o) => o.id === this.config.statusBelowLimit
  )!;

  constructor(
    private vrchat: VRChatService,
    private sanitizer: DomSanitizer,
    private automationConfig: AutomationConfigService,
    private modalService: ModalService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.automationConfig.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.config = cloneDeep(configs.CHANGE_STATUS_BASED_ON_PLAYER_COUNT);
        this.limit.next(this.config.limit);
        this.optionSetStatusAtLimitOrAbove = this.statusOptions.find(
          (o) => o.id === this.config.statusAtLimitOrAbove
        )!;
        this.optionSetStatusBelowLimit = this.statusOptions.find(
          (o) => o.id === this.config.statusBelowLimit
        )!;
      });
    this.vrchat.status.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.loggedIn = status === 'LOGGED_IN';
    });
    this.limit
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((limit) => (this.bedLimit = Math.min(limit, 10))),
        distinctUntilChanged(),
        filter((limit) => limit !== this.config.limit),
        debounceTime(300),
        switchMap((limit) => this.updateConfig({ limit }))
      )
      .subscribe();
  }

  login() {
    this.vrchat.showLoginModal();
  }

  async updateConfig(config: Partial<ChangeStatusBasedOnPlayerCountAutomationConfig>) {
    await this.automationConfig.updateAutomationConfig(
      'CHANGE_STATUS_BASED_ON_PLAYER_COUNT',
      config
    );
  }

  async setStatus(status: UserStatus) {
    await this.vrchat.setStatus(status);
  }

  onLimitChange(value: string | number) {
    if (typeof value === 'string') {
      if (value.trim() === '') return;
      value = parseInt(value) || 1;
    }
    this.limit.next(clamp(value, 1, 40));
  }

  async setStatusSetOption(
    option: 'belowLimit' | 'atLimitOrAbove',
    value: SelectBoxItem | undefined
  ) {
    if (value === undefined) return;
    await this.updateConfig({
      [option === 'belowLimit' ? 'statusBelowLimit' : 'statusAtLimitOrAbove']: value.id,
    });
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
