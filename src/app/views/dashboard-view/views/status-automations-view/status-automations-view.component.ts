import { Component, OnDestroy, OnInit } from '@angular/core';
import { fade, hshrink, noop, vshrink } from '../../../../utils/animations';
import { VRChatService } from '../../../../services/vrchat.service';
import { BehaviorSubject, debounceTime, Subject, switchMap, takeUntil, tap } from 'rxjs';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { DomSanitizer } from '@angular/platform-browser';
import { UserStatus } from 'vrchat/dist';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  ChangeStatusBasedOnPlayerCountAutomationConfig,
} from '../../../../models/automations';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { SimpleModalService } from 'ngx-simple-modal';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../components/confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-status-automations-view',
  templateUrl: './status-automations-view.component.html',
  styleUrls: ['./status-automations-view.component.scss'],
  animations: [vshrink(), noop(), hshrink()],
})
export class StatusAutomationsViewComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject<void>();
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
      label: 'Join Me',
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: #409eff; font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
    {
      id: 'active',
      label: 'Online',
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: #67c23a; font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
    {
      id: 'ask me',
      label: 'Ask Me',
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: #fd9200; font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
      ),
    },
    {
      id: 'busy',
      label: 'Do Not Disturb',
      htmlPrefix: this.sanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons-round" style="color: #f56c6c; font-size: 1.25em; margin-right: 0.25em;">brightness_1</i>'
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
    private modalService: SimpleModalService
  ) {}

  ngOnInit(): void {
    this.automationConfig.configs.pipe(takeUntil(this.destroy$)).subscribe(async (configs) => {
      this.config = cloneDeep(configs.CHANGE_STATUS_BASED_ON_PLAYER_COUNT);
      this.limit.next(this.config.limit);
      this.optionSetStatusAtLimitOrAbove = this.statusOptions.find(
        (o) => o.id === this.config.statusAtLimitOrAbove
      )!;
      this.optionSetStatusBelowLimit = this.statusOptions.find(
        (o) => o.id === this.config.statusBelowLimit
      )!;
    });
    this.vrchat.status.pipe(takeUntil(this.destroy$)).subscribe((status) => {
      this.loggedIn = status === 'LOGGED_IN';
    });
    this.limit
      .pipe(
        takeUntil(this.destroy$),
        tap((limit) => (this.bedLimit = Math.min(limit, 10))),
        debounceTime(300),
        switchMap((limit) => this.updateConfig({ limit }))
      )
      .subscribe();
  }
  ngOnDestroy() {
    this.destroy$.next();
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

  onLimitChange(value: string) {
    if (value.trim() === '') return;
    this.limit.next(Math.min(Math.max(parseInt(value) || 1, 1), 40));
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
        message: `Here you can find the answers to some questions you might have about the status change behaviour:

Q: Can I still automatically accept invite requests, even if VRChat does not show that I am on blue?
A: If you have Oyasumi set your status to blue (join me), it will take over the responsibility of automatically accepting any invite requests you receive.

Q: People cannot join me because my status does not update for them.
A: Status updates can take a while to be shown to other users. If they want to join you but can't, they can force your status to refresh by opening your profile in the main menu.`,
        confirmButtonText: 'shared.modals.ok',
        showCancel: false,
      })
      .subscribe();
  }
}
