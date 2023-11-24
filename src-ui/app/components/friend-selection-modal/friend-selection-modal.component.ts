import { Component, DestroyRef, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, hshrink, noop, vshrink } from '../../utils/animations';
import { LimitedUser, UserStatus } from 'vrchat/dist';
import { VRChatService } from '../../services/vrchat.service';
import {
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  startWith,
} from 'rxjs';
import Fuse from 'fuse.js';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { error } from 'tauri-plugin-log-api';
import { sortBy } from 'lodash';

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
  selection?: SelectedFriend[];
}

const MAX_RESULTS = 50;
const STATUS_SORT_ORDER: Record<UserStatus, number> = {
  [UserStatus.JoinMe]: 1,
  [UserStatus.Active]: 2,
  [UserStatus.AskMe]: 3,
  [UserStatus.Busy]: 4,
  [UserStatus.Offline]: 5,
};

@Component({
  selector: 'app-friend-selection-modal',
  templateUrl: './friend-selection-modal.component.html',
  styleUrls: ['./friend-selection-modal.component.scss'],
  animations: [fadeUp(), vshrink(), hshrink(), fade(), noop()],
})
export class FriendSelectionModalComponent
  extends BaseModalComponent<FriendSelectionInputModel, FriendSelectionOutputModel>
  implements OnInit, FriendSelectionInputModel
{
  selection: SelectedFriend[] = [];
  initialSelection: SelectedFriend[] = [];
  friends: LimitedUser[] = [];
  results: LimitedUser[] = [];
  query: BehaviorSubject<string> = new BehaviorSubject<string>('');
  activeQuery: string = this.query.value;
  fuse?: Fuse<LimitedUser>;
  loadingState: 'LOADING' | 'LOADED' | 'ERROR' = 'LOADING';
  moreResults = false;

  constructor(protected vrchat: VRChatService, private destroyRef: DestroyRef) {
    super();
  }

  async ngOnInit(): Promise<void> {
    this.selection = this.selection ?? [];
    this.initialSelection = [...this.selection];
    await firstValueFrom(this.vrchat.user.pipe(filter(Boolean)));
    this.query
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        debounceTime(200),
        startWith(this.query.value),
        distinctUntilChanged()
      )
      .subscribe((query) => this.search(query));
    this.loadFriends();
  }

  async loadFriends() {
    this.loadingState = 'LOADING';
    try {
      this.friends = await this.vrchat.listFriends();
      this.friends = sortBy(this.friends, [
        (friend) => STATUS_SORT_ORDER[friend.status] ?? 6,
        'displayName',
      ]);
    } catch (e) {
      this.loadingState = 'ERROR';
      error('[FriendSelectionModal] Failed to load friends: ' + e);
      return;
    }
    const fuseOptions = {
      keys: ['displayName'],
      findAllMatches: false,
      threshold: 0.3,
    };
    const fuseIndex = Fuse.createIndex(fuseOptions.keys, this.friends);
    this.fuse = new Fuse(this.friends, fuseOptions, fuseIndex);
    if (!this.query.value.trim()) {
      this.moreResults = this.friends.length > MAX_RESULTS;
      this.results = this.friends.slice(0, MAX_RESULTS);
    }
    this.loadingState = 'LOADED';
  }

  async cancel() {
    await this.close();
  }

  async confirm() {
    this.result = { selection: this.selection };
    await this.close();
  }

  async search(query: string) {
    if (!this.fuse || this.loadingState !== 'LOADED') return;
    this.activeQuery = query.trim();
    if (!this.activeQuery) {
      this.moreResults = this.friends.length > MAX_RESULTS;
      this.results = this.friends.slice(0, MAX_RESULTS);
      return;
    }
    const results = this.fuse!.search(this.activeQuery);
    this.moreResults = results.length > MAX_RESULTS;
    this.results = results.slice(0, MAX_RESULTS).map((r) => r.item);
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
