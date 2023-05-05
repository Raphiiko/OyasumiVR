import { Component, OnDestroy, OnInit } from '@angular/core';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import { VRChatService } from '../../../../services/vrchat.service';
import { hshrink, noop, vshrink } from '../../../../utils/animations';
import { ModalService } from 'src/app/services/modal.service';
import {
  FriendSelectionModalComponent,
  SelectedFriendPlayer,
} from '../../../../components/friend-selection-modal/friend-selection-modal.component';
import { cloneDeep, isEqual } from 'lodash';
import { LimitedUser } from 'vrchat/dist';
import {
  AutoAcceptInviteRequestsAutomationConfig,
  AUTOMATION_CONFIGS_DEFAULT,
} from '../../../../models/automations';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { ConfirmModalComponent } from '../../../../components/confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-auto-invite-request-accept-view',
  templateUrl: './auto-invite-request-accept-view.component.html',
  styleUrls: ['./auto-invite-request-accept-view.component.scss'],
  animations: [vshrink(), noop(), hshrink()],
})
export class AutoInviteRequestAcceptViewComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject<void>();
  loggedIn = false;
  playerList: LimitedUser[] = [];
  listModeOption?: SelectBoxItem;
  listModeOptions: SelectBoxItem[] = [
    {
      id: 'DISABLED',
      label: 'auto-invite-request-accept.options.listMode.options.DISABLED.label',
      subLabel: 'auto-invite-request-accept.options.listMode.options.DISABLED.subLabel',
    },
    {
      id: 'WHITELIST',
      label: 'auto-invite-request-accept.options.listMode.options.WHITELIST.label',
      subLabel: 'auto-invite-request-accept.options.listMode.options.WHITELIST.subLabel',
    },
    {
      id: 'BLACKLIST',
      label: 'auto-invite-request-accept.options.listMode.options.BLACKLIST.label',
      subLabel: 'auto-invite-request-accept.options.listMode.options.BLACKLIST.subLabel',
    },
  ];
  config: AutoAcceptInviteRequestsAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.AUTO_ACCEPT_INVITE_REQUESTS
  );
  isOnBusyStatus = false;
  isOnJoinMeStatus = false;

  constructor(
    protected vrchat: VRChatService,
    private modal: ModalService,
    private automationConfig: AutomationConfigService,
    private modalService: ModalService
  ) {}

  ngOnInit(): void {
    this.vrchat.status
      .pipe(takeUntil(this.destroy$), distinctUntilChanged())
      .subscribe(async (status) => {
        this.loggedIn = status === 'LOGGED_IN';
        if (this.loggedIn && this.config.playerIds.length) await this.refreshPlayerList();
      });
    this.vrchat.user.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      this.isOnBusyStatus = user?.status === 'busy';
      this.isOnJoinMeStatus = user?.status === 'join me';
    });
    this.automationConfig.configs.pipe(takeUntil(this.destroy$)).subscribe(async (configs) => {
      this.config = cloneDeep(configs.AUTO_ACCEPT_INVITE_REQUESTS);
      this.listModeOption = this.listModeOptions.find((o) => o.id === this.config.listMode)!;
      const playersChanged = !isEqual(
        [...this.config.playerIds].sort(),
        this.playerList.map((o) => o.id).sort()
      );
      if (this.loggedIn && playersChanged) await this.refreshPlayerList();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
  }

  login() {
    this.vrchat.showLoginModal();
  }

  async updateConfig(config: Partial<AutoAcceptInviteRequestsAutomationConfig>) {
    await this.automationConfig.updateAutomationConfig('AUTO_ACCEPT_INVITE_REQUESTS', config);
  }

  async refreshPlayerList() {
    const friends = await this.vrchat.listFriends();
    this.playerList = friends.filter((f) => this.config.playerIds.includes(f.id));
    await this.updateConfig({ playerIds: this.playerList.map((p) => p.id) });
  }

  addPlayer() {
    this.modal
      .addModal(FriendSelectionModalComponent, {
        selection: this.playerList.map(
          (p) =>
            ({
              type: 'player',
              playerId: p.id,
              playerName: p.displayName,
            } as SelectedFriendPlayer)
        ),
      })
      .subscribe(async (result) => {
        if (!result) return;
        const friends = await this.vrchat.listFriends();
        this.playerList = result.selection
          .filter((r) => r.type === 'player')
          .map((r) => r as SelectedFriendPlayer)
          .map((r) => friends.find((f) => f.id === r.playerId))
          .filter(Boolean) as LimitedUser[];
        await this.updateConfig({ playerIds: this.playerList.map((p) => p.id) });
      });
  }

  async removePlayer(player: LimitedUser) {
    this.modalService
      .addModal(ConfirmModalComponent, {
        title: 'auto-invite-request-accept.removeModal.title',
        message: {
          string: 'auto-invite-request-accept.removeModal.message',
          values: { name: player.displayName },
        },
      })
      .subscribe(async (data) => {
        if (data?.confirmed) {
          this.playerList = this.playerList.filter((p) => p.id !== player.id);
          await this.updateConfig({ playerIds: this.playerList.map((p) => p.id) });
        }
      });
  }

  async clearPlayers() {
    this.modalService
      .addModal(ConfirmModalComponent, {
        title: 'auto-invite-request-accept.removeModalBulk.title',
        message: {
          string: 'auto-invite-request-accept.removeModalBulk.message',
        },
      })
      .subscribe(async (data) => {
        if (data.confirmed) {
          this.playerList = [];
          await this.updateConfig({ playerIds: this.playerList.map((p) => p.id) });
        }
      });
  }

  async setListMode(id?: string) {
    if (!id || !this.listModeOptions.map((o) => o.id).includes(id)) return;
    await this.updateConfig({ listMode: id } as Partial<AutoAcceptInviteRequestsAutomationConfig>);
  }
}
