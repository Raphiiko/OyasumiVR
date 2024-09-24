import { Component, DestroyRef, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { TString } from '../../models/translatable-string';
import { VRChatService } from '../../services/vrchat.service';
import { LimitedUser } from 'vrchat';
import {
  FriendSelectionModalComponent,
  SelectedFriendPlayer,
} from '../friend-selection-modal/friend-selection-modal.component';
import { ConfirmModalComponent } from '../confirm-modal/confirm-modal.component';
import {
  PlayerListPresetModalComponent,
  PlayerListPresetModalInputModel,
  PlayerListPresetModalOutputModel,
} from '../player-list-preset-modal/player-list-preset-modal.component';
import { ModalService } from '../../services/modal.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged } from 'rxjs';
import { noop, vshrink } from '../../utils/animations';

@Component({
  selector: 'app-player-list',
  templateUrl: './player-list.component.html',
  styleUrls: ['./player-list.component.scss'],
  animations: [vshrink(), noop()],
})
export class PlayerListComponent implements OnInit {
  @Input() title: TString = 'comp.player-list.title';
  @Output() playerIdsChange = new EventEmitter<string[]>();

  @Input() set playerIds(value: string[]) {
    this.refreshPlayerList(value);
  }

  playerList: LimitedUser[] = [];
  loggedIn = false;

  constructor(
    protected vrchat: VRChatService,
    private modalService: ModalService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit() {
    this.vrchat.status
      .pipe(takeUntilDestroyed(this.destroyRef), distinctUntilChanged())
      .subscribe(async (status) => {
        this.loggedIn = status === 'LOGGED_IN';
        if (this.loggedIn && this.playerList.length)
          await this.refreshPlayerList(this.playerList.map((p) => p.id));
      });
  }

  private emitPlayerListChange() {
    this.playerIdsChange.emit(this.playerList.map((p) => p.id));
  }

  async refreshPlayerList(playerIds: string[]) {
    const input = [...playerIds].sort();
    const current = [...this.playerList.map((p) => p.id)].sort();
    if (input.join(',') === current.join(',')) return;
    const friends = await this.vrchat.listFriends();
    this.playerList = friends.filter((f) => playerIds.includes(f.id));
    this.emitPlayerListChange();
  }

  addPlayer() {
    this.modalService
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
        if (!result || result.selection === undefined) return;
        this.playerIds = result.selection
          .filter((r) => r.type === 'player')
          .map((r) => r as SelectedFriendPlayer)
          .map((r) => r.playerId);
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
          this.playerIds = this.playerList.filter((p) => p.id !== player.id).map((p) => p.id);
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
        if (data?.confirmed) this.playerIds = [];
      });
  }

  async loadPreset() {
    this.modalService
      .addModal<PlayerListPresetModalInputModel, PlayerListPresetModalOutputModel>(
        PlayerListPresetModalComponent,
        {
          mode: 'load',
        },
        {}
      )
      .subscribe((result) => {
        if (result?.playerIds) {
          this.playerIds = result.playerIds;
        }
      });
  }

  async savePreset() {
    this.modalService
      .addModal<PlayerListPresetModalInputModel, PlayerListPresetModalOutputModel>(
        PlayerListPresetModalComponent,
        {
          mode: 'save',
          playerIds: this.playerList.map((p) => p.id),
        }
      )
      .subscribe();
  }
}
