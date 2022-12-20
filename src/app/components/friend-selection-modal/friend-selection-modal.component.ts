import { Component, OnDestroy, OnInit } from '@angular/core';
import { SimpleModalComponent } from 'ngx-simple-modal';
import { fade, fadeUp, hshrink, noop, vshrink } from '../../utils/animations';
import { LimitedUser } from 'vrchat/dist';
import { VRChatService } from '../../services/vrchat.service';
import {
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  startWith,
  Subject,
  takeUntil,
} from 'rxjs';
import Fuse from 'fuse.js';

export type SelectedFriend = SelectedFriendGroup | SelectedFriendPlayer;

export interface SelectedFriendGroup {
  type: 'group';
}

export interface SelectedFriendPlayer {
  type: 'player';
  playerId: string;
  playerName: string;
}

export interface FriendSelectionInputModel {
  selection?: SelectedFriend[];
}

export interface FriendSelectionOutputModel {
  selection: SelectedFriend[];
}

@Component({
  selector: 'app-friend-selection-modal',
  templateUrl: './friend-selection-modal.component.html',
  styleUrls: ['./friend-selection-modal.component.scss'],
  animations: [fadeUp(), vshrink(), hshrink(), fade(), noop()],
})
export class FriendSelectionModalComponent
  extends SimpleModalComponent<FriendSelectionInputModel, FriendSelectionOutputModel>
  implements OnInit, FriendSelectionInputModel, OnDestroy
{
  private destroy$: Subject<void> = new Subject<void>();
  selection: SelectedFriend[] = [];
  initialSelection: SelectedFriend[] = [];
  friends: LimitedUser[] = [];
  results: LimitedUser[] = [];
  query: BehaviorSubject<string> = new BehaviorSubject<string>('');
  activeQuery: string = this.query.value;

  constructor(protected vrchat: VRChatService) {
    super();
  }

  async ngOnInit(): Promise<void> {
    this.selection = this.selection ?? [];
    this.initialSelection = [...this.selection];
    await firstValueFrom(this.vrchat.user.pipe(filter(Boolean)));
    this.friends = await this.vrchat.listFriends();
    this.query
      .pipe(
        takeUntil(this.destroy$),
        debounceTime(300),
        startWith(this.query.value),
        distinctUntilChanged()
      )
      .subscribe((query) => this.search(query));
    this.results = this.friends;
  }

  ngOnDestroy() {
    this.destroy$.next();
  }

  async cancel() {
    this.result = { selection: this.initialSelection };
    await this.close();
  }

  async confirm() {
    this.result = { selection: this.selection };
    await this.close();
  }

  async search(query: string) {
    this.activeQuery = query.trim();
    if (!this.activeQuery) {
      this.results = this.friends;
      return;
    }
    const fuse = new Fuse(this.friends, {
      keys: ['displayName'],
      findAllMatches: true,
      threshold: 0.3,
    });
    this.results = fuse.search(this.activeQuery).map((r) => r.item);
  }

  removeItem(item: SelectedFriendGroup | SelectedFriendPlayer) {
    this.selection = this.selection.filter((i) => i !== item);
  }

  addFriend(friend: LimitedUser) {
    if (this.selection.find((i) => i.type === 'player' && i.playerId === friend.id)) return;
    this.selection = [
      {
        type: 'player',
        playerId: friend.id,
        playerName: friend.displayName,
      },
      ...this.selection,
    ];
  }

  isSelected(user: LimitedUser): boolean {
    return !!this.selection.find((s) => s.type === 'player' && s.playerId === user.id);
  }
}
