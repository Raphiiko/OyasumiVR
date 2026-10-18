import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  ChangeDetectionStrategy,
  effect,
  input,
  model,
  untracked,
} from '@angular/core';
import { TString } from '../../models/translatable-string';
import { VRChatService } from '../../services/vrchat-api/vrchat.service';
import type { LimitedUserFriend } from 'vrchat';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class PlayerListComponent implements OnInit {
  readonly title = input<TString>('comp.player-list.title');
  /** Emits only the IDs of current friends: the list drops any other ID after it loads. */
  readonly playerIds = model<string[]>([]);

  playerList: LimitedUserFriend[] = [];
  loggedIn = false;

  constructor(
    protected vrchat: VRChatService,
    private modalService: ModalService,
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef
  ) {
    effect(() => {
      const playerIds = this.playerIds();
      untracked(() => this.refreshPlayerList(playerIds));
    });
  }

  ngOnInit() {
    this.vrchat.status
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(async (status) => {
        this.loggedIn = status === 'LOGGED_IN';
        this.cdr.markForCheck();
        if (this.loggedIn && this.playerList.length)
          await this.refreshPlayerList(this.playerList.map((p) => p.id));
      });
  }

  async refreshPlayerList(playerIds: string[]) {
    const input = [...playerIds].sort();
    const current = [...this.playerList.map((p) => p.id)].sort();
    if (input.join(',') === current.join(',')) return;
    let friends: LimitedUserFriend[];
    try {
      friends = await this.vrchat.listFriends();
    } catch {
      return;
    }
    this.playerList = friends.filter((f) => playerIds.includes(f.id));
    this.cdr.markForCheck();
    this.playerIds.set(this.playerList.map((p) => p.id));
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
            }) as SelectedFriendPlayer
        ),
      })
      .subscribe(async (result) => {
        if (!result || result.selection === undefined) return;
        await this.refreshPlayerList(
          result.selection
            .filter((r) => r.type === 'player')
            .map((r) => r as SelectedFriendPlayer)
            .map((r) => r.playerId)
        );
      });
  }

  async removePlayer(player: LimitedUserFriend) {
    this.modalService
      .addModal(ConfirmModalComponent, {
        title: 'comp.player-list.removeModal.title',
        message: {
          string: 'comp.player-list.removeModal.message',
          values: { name: player.displayName },
        },
      })
      .subscribe(async (data) => {
        if (data?.confirmed) {
          await this.refreshPlayerList(
            this.playerList.filter((p) => p.id !== player.id).map((p) => p.id)
          );
        }
      });
  }

  async clearPlayers() {
    this.modalService
      .addModal(ConfirmModalComponent, {
        title: 'comp.player-list.removeModalBulk.title',
        message: {
          string: 'comp.player-list.removeModalBulk.message',
        },
      })
      .subscribe(async (data) => {
        if (data?.confirmed) await this.refreshPlayerList([]);
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
      .subscribe(async (result) => {
        if (result?.playerIds) {
          await this.refreshPlayerList(result.playerIds);
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
